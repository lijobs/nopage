import React from 'react';
import PropTypes from 'prop-types';
import BaseItem from './BaseItem';
import { ANY_CHANGE, EDIT, HIDDEN, FOCUS, BLUR, STATUS_ENUMS, ON_EVENT } from '../static';
import genId from '../util/random';
import { isObject, isFunction } from '../util/is';
import FormContext from '../context/form';
import IfContext from '../context/if';
import ItemContext from '../context/item';
import Section from './Section';

const formItemPrefix = 'no-form';
const noop = () => { };
const getValue = (jsxProps) => {
    const hasVal = ('value' in jsxProps);
    if (hasVal) {
        return jsxProps.value;
    }
    return null;
};

const getDefaultValue = (jsxProps) => {
    const hasDefaultVal = ('defaultValue' in jsxProps);
    if (hasDefaultVal) {
        return jsxProps.defaultValue;
    }
    return null;
};

class BaseFormItem extends React.Component {
    static propTypes = {
        name: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        value: PropTypes.any,
        children: PropTypes.any,
        onBlur: PropTypes.func,
        onFocus: PropTypes.func,
        render: PropTypes.func,
        inset: PropTypes.bool,
        listenKeys: PropTypes.array,
    }

    static defaultProps = {
        name: '',
        children: null,
        onBlur: noop,
        onFocus: noop,
        listenKeys: [],
    }

    constructor(props) {
        super(props);
        const { form, ifCore } = props;
        if (!form) {
            return this;
        }

        this.form = form;
        this.compProps = {};
        this.eventProps = {};
        this.predictChildForm = this.handlePredictForm(props, (component) => {
            const { props: comProps = {} } = component || {};
            // 自动获取jsx组件属性，下个y位版本自动升级
            if (this.form.enableReceiveProps) {
                this.compProps = this.pickupComponentProps(comProps);
            }
        });

        this.core = this.initialCore(props, this.compProps);
        this.core.predictChildForm = this.predictChildForm;
        this.core.jsx = this;
        this.core.getSuperFormProps = this.getSuperFormProps.bind(this);

        // 引用，提升渲染性能，避免重复渲染子类
        this.wrapperElement = React.createRef();
        this.labelElement = React.createRef();
        this.fullElement = React.createRef();

        this.ifCore = ifCore;
        this.id = this.core.id || `__noform__item__${genId()}`;

        if (props.name) {
            this.name = props.name;
        }
    }

    componentDidMount() { // 绑定set事件就会执行更新 TODO：优化渲染
        this.form.on(ANY_CHANGE, this.update);
        const { childForm } = this.core;
        if (childForm && !childForm.disabledSyncChildForm) {
            this.form.setValueSilent(this.core.name, childForm.getAll('value'));
            this.form.setProps(this.core.name, childForm.getAll('props'));
            this.form.setStatus(this.core.name, childForm.getAll('status'));
            this.form.setError(this.core.name, childForm.getAll('error'));
            childForm.on(ANY_CHANGE, (type) => {
                if (type === 'value') {
                    return;
                }

                this.form.set(type, this.core.name, childForm.getAll(type));
            });
        }
        this.didMount = true;
        this.forceUpdate();
    }

    componentWillReceiveProps = (nextProps) => {
        const { jsx_status, func_status } = this.core;
        const { status } = nextProps;
        let needConsist = false;
        if (typeof status === 'function' && func_status !== status) {
            this.core.func_status = status;
            needConsist = true;
        } else if (STATUS_ENUMS.has(status) && status !== jsx_status) {
            this.core.jsx_status = status;
            needConsist = true;
        }

        if (needConsist) {
            const value = this.form.getAll('value');
            const silent = true;
            this.core.consistStatus(value, silent);
        }
    }

    componentWillUnmount() { // 解绑
        this.form.removeListener(ANY_CHANGE, this.update);
        this.didMount = false;
    }

    onChange = (...args) => {        
        const [e, opts = {}] = args;
        const { escape = false } = opts; // 直接用原生对象不进行判断

        let val = e;
        if (!escape) {
            if (e && e.target) {
                if ('value' in e.target) {
                    val = e.target.value;
                } else if ('checked' in e.target) {
                    val = e.target.checked;
                }
            }

            if (isObject(val)) {
                const tmpStr = JSON.stringify(val);
                try {
                    val = JSON.parse(tmpStr);
                } catch (exception) {
                    val = {};
                }
            }
        }
        
        this.form.currentCore = this.core;
        this.form.currentEventOpts = opts;
        this.form.currentEventType = 'manual';
        this.core.set('value', val, escape);
        Promise.resolve().then(() => {
            this.form.currentCore = null;
            this.form.currentEventOpts = null;
            this.form.currentEventType = 'api';
        });

        const { onChange } = this.props;
        this.onEvent('onChange', args);
        if (onChange) onChange(...args); // 把原本劫持的方法提供api供开发者使用
    }

    onBlur = () => {
        this.core.emit(BLUR, this.core.name);
        this.onEvent('onBlur', []);
        if (typeof this.props.onBlur === 'function') {
            this.props.onBlur();
        }
    }
    onFocus = () => {
        this.core.emit(FOCUS, this.core.name);
        this.onEvent('onFocus', []);
        if (typeof this.props.onFocus === 'function') {
            this.props.onFocus();
        }
    }

    onEvent = (functionName, args) => {
        this.core.emit(ON_EVENT, {
            fireKey: this.core.name,
            fn: functionName,
            args
        });
    }

    getBaseProps = () => {
        Object.keys(this.props || {}).forEach(propKey => {
            if (typeof propKey === 'string' && propKey.startsWith('on') &&
                ['onChange', 'onBlur', 'onFocus', 'onEvent'].indexOf(propKey) === -1 &&
                typeof this.props[propKey] === 'function') {
                if (!this[propKey]) {
                    this.eventProps[propKey] = (...args) => {
                        this.onEvent(propKey, args);
                        if (this.props[propKey]) this.props[propKey](...args);
                    }
                }
            }
        });

        return {
            eventProps: this.eventProps,
            predictChildForm: this.predictChildForm,
            children: this.props.children,
            render: this.props.render,
            didMount: this.didMount,
            form: this.form,
            onChange: this.onChange,
            onBlur: this.onBlur,
            onFocus: this.onFocus,
            inset: this.props.inset,
            name: this.core.name,
            formProps: this.predictChildForm ? this.getSuperFormProps() : {},
        };
    }

    getSuperFormProps = () => {
        let formProps = {};
        if (this.core.form && this.core.form.jsx.props) {
            const {
                defaultMinWidth, full, inline, inset, layout, colon,
            } = this.core.form.jsx.props;

            formProps = {
                defaultMinWidth, full, inline, inset, layout, colon,
            };
        }

        return formProps;
    }

    getWrapperClassName = () => {
        const isFlex = this.getIsFlexMode();
        const { name, error: propError } = this.props;
        const inset = this.props.inset || this.form.jsx.props.inset;
        let error = this.form.getItemError(name); // 动态error
        if (!name) {
            error = propError;
        }

        // 处理错误信息
        let hasMainError = !!error;
        let hasSubError = false;
        if (isObject(error)) { // 对象的情况
            hasMainError = error.main;
            hasSubError = error.sub;
        }

        let flexCls = '';
        if (isFlex) {
            flexCls = `${formItemPrefix}-item-flex`;
        }

        const insetCls = inset ? `${formItemPrefix}-item-inset` : '';
        const errCls = hasMainError ? `${formItemPrefix}-item-has-error` : '';
        const subErrCls = hasSubError ? `${formItemPrefix}-item-has-sub-error` : '';
        return `${insetCls} ${errCls} ${subErrCls} ${flexCls}`;
    }

    getLabelClassName = () => {
        const { name, status: propStatus } = this.props;
        const props = this.form.getItemProps(name) || {}; // 动态props
        const status = name ? this.form.getItemStatus(name) : propStatus; // 动态status
        const layoutProps = {
            ...this.form.jsx.props,
            ...this.props,
        };

        // 保留item关键字属性
        const { required } = { ...this.props, ...props };

        let requiredCls = '';
        if (required && (status === EDIT || `${name}` === '')) {
            requiredCls = ' required';
        }

        const layout = layoutProps.layout || {};
        return `${formItemPrefix}-item-label ${requiredCls} ${layout.label ? `col-${layout.label}` : ''}`;
    }

    getIsFlexMode = () => {
        const { flex = false } = this.props;
        return flex;
    }

    getFullClassName = () => {
        const { name } = this.props;
        const props = this.form.getItemProps(name) || {}; // 动态props

        // 保留item关键字属性
        const { full: coreFull } = { ...this.props, ...props };

        // 处理布局
        const { inset = false, full: jsxFull } = {
            ...this.form.jsx.props,
            ...this.props,
        };

        const full = jsxFull || coreFull || inset;
        return `${formItemPrefix}-item-content ${full ? `${formItemPrefix}-full` : ''}`;
    }

    pickupComponentProps = (props) => {
        const reservedWords = [
            'name', 'value', 'error', 'props',
            'label', 'required', 'suffix', 'prefix', 'top', 'help',
            'onChange', 'onBlur', 'onFocus', 'key',
            'children',
        ];

        const comp = {};
        Object.keys(props || {}).forEach((key) => {
            if (reservedWords.indexOf(key) === -1) {
                comp[key] = props[key];
            }
        });

        return comp;
    }

    initialCore = (props, componentProps = {}) => {
        const {
            name, error, props: itemProps, status,
            form, ifCore,
        } = props;

        const value = getValue(props);        
        const defaultValue = getDefaultValue(props);

        const option = {
            error,
            value,
            name,
            defaultValue,
        };

        // 上有if item
        if (ifCore) {
            option.when = ifCore.when;
            option.parentIf = ifCore.parentIf;
        }

        // 处理props
        if ('props' in props) {
            if (isFunction(itemProps)) {
                option.func_props = itemProps;
                option.props = {};
            } else {
                option.props = { ...componentProps, ...itemProps };
            }
        } else {
            option.props = { ...componentProps };
        }

        // 处理status
        if ('status' in props) {
            if (isFunction(status)) {
                option.func_status = status;
            } else {
                option.status = status;
            }
        }

        // 校验规则, 拦截器，when, 及id
        ['validateConfig', 'interceptor', 'id', 'when'].forEach((key) => {
            if (key in props) {
                option[key] = props[key];
            }
        });


        const core = form.addField(option);
        return core;
    }

    handlePredictForm = (props, sideEffect) => {
        // 构建时提前知道子类，比didmount再来通知，把控性好很多
        const { children } = props;
        this.displayName = '';
        if (children) {
            if (React.isValidElement(children)) {
                const jsxComponent = React.Children.only(children);
                if (jsxComponent) {
                    sideEffect(jsxComponent);
                }
                if (jsxComponent && jsxComponent.type && jsxComponent.type.displayName) {
                    this.displayName = jsxComponent.type.displayName;
                }
            }
        }

        const predictForm = this.displayName === 'NoForm';
        return predictForm;
    }

    hitListenKeys = (key) => {
        const { listenKeys, render } = this.props;
        if (render) {
            if (listenKeys.length === 0) {
                return true;
            }
            return listenKeys.indexOf(key) !== -1;
        }
        return this.core.name === key;
    }

    update = (type, name, value, silent = false) => {
        // value, props, error, status
        const { listenError = false, listenProps = false } = this.props;
        const hitListen = this.hitListenKeys(name);
        const canUpdate = this.didMount &&
            hitListen && !silent;
        if (canUpdate) {            
            switch (type) {
            case 'status':
                this.forceUpdate(); break;
            case 'error':
                if (this.wrapperElement.current) {
                    this.wrapperElement.current.className = this.getWrapperClassName();
                }

                if (listenError) {
                    this.forceUpdate();
                }
                break;
            case 'props':
                if (this.fullElement.current) {
                    this.fullElement.current.className = this.getFullClassName();
                    this.labelElement.current.className = this.getLabelClassName();
                }

                if (listenProps) {
                    this.forceUpdate();
                }
                break;
            case 'value':
                if (this.props.render && canUpdate) {
                    this.forceUpdate();
                }
                break;
            default: break;
            }
        }
    }

    render() {
        const { noLayout, children, ...itemProps } = this.props;
        const {
            errorRender, className = '', name, style = {}, status: propStatus,
        } = itemProps;
        const status = name ? this.form.getItemStatus(name) : propStatus; // 动态status        

        // 状态隐藏
        if (status === HIDDEN) {
            return null;
        }

        // 处理布局
        const {
            inline = false, inset = false, colon, layout: originLayout,
            labelWidth,
            defaultMinWidth = true,
        } = {
            ...this.form.jsx.props,
            ...itemProps,
        };

        const layout = originLayout || {};
        const defaultMinCls = defaultMinWidth ? `${formItemPrefix}-item-default-width` : `${formItemPrefix}-item-no-default-width`;
        const layoutCls = (layout.label && layout.control) ? `${formItemPrefix}-item-has-layout` : '';
        const colonCls = colon ? '' : `${formItemPrefix}-item-no-colon`;
        const inlineCls = inline ? `${formItemPrefix}-item-inline` : '';

        const baseProps = this.getBaseProps();
        const itemContext = { item: this.core };
        const baseElement = (<ItemContext.Provider value={itemContext}>
            <BaseItem {...baseProps} />
        </ItemContext.Provider>);
        if (noLayout) {
            return baseElement;
        }

        // 以下组件的渲染不与formItem公用，避免重复渲染(label, top, suffix, prefix, help, required, full)
        // error比较特殊, 需要考虑自定义errorRender
        const sectionValue = { form: this.form, ...itemProps, core: this.core };
        delete sectionValue.className;
        const labelElement = <Section type="props" field="label" {...sectionValue} pure />;
        const prefixElement = <Section type="props" field="prefix" className={`${formItemPrefix}-item-content-prefix`} {...sectionValue} />;
        const suffixElement = <Section type="props" field="suffix" className={`${formItemPrefix}-item-content-suffix`} {...sectionValue} />;
        const topElement = <Section type="props" field="top" className={`${formItemPrefix}-item-top`} {...sectionValue} />;
        const helpElement = <Section type="props" field="help" className={`${formItemPrefix}-item-help`} {...sectionValue} />;
        const errElement = <Section type="error" className={`${formItemPrefix}-item-error`} {...sectionValue} errorRender={errorRender} />;

        // 避免重复渲染
        const wrapperCls = this.getWrapperClassName(); // no-form-item
        const labelCls = this.getLabelClassName(); // no-form-item-label
        const fullCls = this.getFullClassName(); // no-form-item-content

        const idProps = {};
        if (itemContext.item && itemContext.item.id &&
            this.id !== itemContext.item.id) {
            idProps.id = itemContext.item.id;
        }

        const labelWidthStyle = {};
        if (labelWidth) {
            labelWidthStyle.style = {
                width: labelWidth,
                display: 'inline-block'
            };
        }

        return (
            <div id={this.id} name={`form-item-${name}`} className={`${formItemPrefix}-item ${className} ${layoutCls} ${colonCls} ${inlineCls} ${defaultMinCls}`} style={style}>
                <div {...idProps} className={wrapperCls} ref={this.wrapperElement}>
                    <span className={labelCls} ref={this.labelElement} {...labelWidthStyle}>{labelElement}</span>
                    <span className={`${formItemPrefix}-item-control ${layout.control ? `col-${layout.control}` : ''}`} >
                        {topElement}
                        <span className={fullCls} ref={this.fullElement}>
                            {prefixElement}
                            <span className={`${formItemPrefix}-item-content-elem is-${status}`}>
                                {baseElement}
                            </span>
                            {suffixElement}
                        </span>
                        {helpElement}
                        { !inset ? errElement : null }
                    </span>
                </div>
                { inset ? errElement : null }
            </div>
        );
    }
}

const ConnectFormItem = props => (<FormContext.Consumer>
    {(formContext) => {
        const { form } = formContext || {};
        return (
            <IfContext.Consumer>
                {(ifCoreContext) => {
                    const { if: ifCore } = ifCoreContext || {};
                    return (<BaseFormItem {...props} form={form} ifCore={ifCore} />);
                }}
            </IfContext.Consumer>
        );
    }}
</FormContext.Consumer>);

ConnectFormItem.displayName = 'FormItem';

export default ConnectFormItem;

