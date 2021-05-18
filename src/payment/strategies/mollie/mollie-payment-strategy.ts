import { each, some } from 'lodash';

import { PaymentActionCreator } from '../..';
import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { getBrowserInfo } from '../../../common/browser-info';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType, RequestError } from '../../../common/error/errors';
import { HostedForm, HostedFormFactory, HostedFormOptions } from '../../../hosted-form';
import { OrderActionCreator, OrderRequestBody } from '../../../order';
import { PaymentArgumentInvalidError } from '../../errors';
import isVaultedInstrument from '../../is-vaulted-instrument';
import { HostedInstrument } from '../../payment';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import { MollieClient, MollieElement } from './mollie';
import MolliePaymentInitializeOptions from './mollie-initialize-options';
import MollieScriptLoader from './mollie-script-loader';

export enum MolliePaymentMethodType {
    creditcard = 'credit_card',
}

export default class MolliePaymentStrategy implements PaymentStrategy {
    private _initializeOptions?: MolliePaymentInitializeOptions;
    private _mollieClient?: MollieClient;
    private _cardHolderElement?: MollieElement;
    private _cardNumberElement?: MollieElement;
    private _verificationCodeElement?: MollieElement;
    private _expiryDateElement?: MollieElement;

    private _hostedForm?: HostedForm;
    private _shouldRenderHostedForm?: boolean;
    constructor(
        private _hostedFormFactory: HostedFormFactory,
        private _store: CheckoutStore,
        private _mollieScriptLoader: MollieScriptLoader,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator
    ) { }

    async initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { mollie, methodId, gatewayId } = options;

        if (!mollie) {
            throw new InvalidArgumentError('Unable to initialize payment because "mollie" argument is not provided.');
        }
        const state = this._store.getState();
        const storeConfig = state.config.getStoreConfig();

        if (!storeConfig) {
            throw new MissingDataError(MissingDataErrorType.MissingCheckoutConfig);
        }

        this._initializeOptions = mollie;

        const paymentMethods = state.paymentMethods;
        const paymentMethod = paymentMethods.getPaymentMethodOrThrow(methodId);
        const { config: { merchantId, testMode } } = paymentMethod;

        if (!merchantId || !gatewayId) {
            throw new InvalidArgumentError('Unable to initialize payment because "merchantId" and "gatewayId" argument is not provided.');
        }

        if (methodId === MolliePaymentMethodType.creditcard) {

            if (mollie.form && this._isHostedPaymentFormEnabled(methodId, gatewayId) && this._isHostedFieldAvailable(options)) {
                await this._mountCardVerificationfields(mollie.form);
            }

            this._mollieClient = await this._loadMollieJs(merchantId, storeConfig.storeProfile.storeLanguage, testMode);
            this._mountElements();
        }

        return Promise.resolve(this._store.getState());
    }

    async execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        const { payment , ...order} = payload;
        const paymentData = payment?.paymentData;
        const shouldSaveInstrument = (paymentData as HostedInstrument)?.shouldSaveInstrument;
        const shouldSetAsDefaultInstrument = (paymentData as HostedInstrument)?.shouldSetAsDefaultInstrument;

        if (!payment || !payment.gatewayId || !paymentData) {
            throw new PaymentArgumentInvalidError([ 'payment', 'gatewayId', 'paymentData' ]);
        }

        try {
            if (payment.methodId === MolliePaymentMethodType.creditcard) {
                await this._store.dispatch(this._orderActionCreator.submitOrder(order, options));

                if (paymentData && isVaultedInstrument(paymentData)) {
                    if (this._isHostedPaymentFormEnabled(payment.methodId, payment.gatewayId) && this._shouldRenderHostedForm) {
                        const form = this._hostedForm;

                        if (!form) {
                            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                        }

                        try {
                            await form.validate();
                            await form.submit(payment);

                            return Promise.resolve(this._store.getState());
                        } catch (error) {
                            throw new Error(error.message);
                        }
                    } else {
                        return await this._store.dispatch(this._paymentActionCreator.submitPayment(payment));
                    }
                }

                const { token, error } = await this._getMollieClient().createToken();

                if (error) {
                    return Promise.reject(error);
                }

                return await this._store.dispatch(this._paymentActionCreator.submitPayment({
                    ...payment,
                    paymentData: {
                        formattedPayload: {
                            credit_card_token: {
                                token,
                            },
                            vault_payment_instrument: shouldSaveInstrument,
                            set_as_default_stored_instrument: shouldSetAsDefaultInstrument,
                            browser_info: getBrowserInfo(),
                        },
                    },
                }));
            } else {
                await this._store.dispatch(this._orderActionCreator.submitOrder(order, options));

                const issuer = 'issuer' in paymentData ? paymentData.issuer : '';

                return await this._store.dispatch(this._paymentActionCreator.submitPayment({
                    ...payment,
                    paymentData: {
                        ...paymentData,
                        formattedPayload: {
                            issuer,
                        },
                    },
                }));
            }
        } catch (error) {

            return this._processAdditionalAction(error);
        }
    }

    finalize(): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
    }

    deinitialize(): Promise<InternalCheckoutSelectors> {
        this._mollieClient = undefined;

        this.removeMollieComponents();

        return Promise.resolve(this._store.getState());
    }

    private async _mountCardVerificationfields(formOptions: HostedFormOptions) {
        if (!formOptions) {
            throw new InvalidArgumentError();
        }

        const { config } = this._store.getState();
        const { paymentSettings: { bigpayBaseUrl: host = '' } = {} } = config.getStoreConfig() || {};
        const form = this._hostedFormFactory.create(host, formOptions);

        await form.attach();
        this._shouldRenderHostedForm = true;
        this._hostedForm = form;
    }

    private _isHostedPaymentFormEnabled(methodId: string, gatewayId: string): boolean {
        const { paymentMethods: { getPaymentMethodOrThrow } } = this._store.getState();
        const paymentMethod = getPaymentMethodOrThrow(methodId, gatewayId);

        return paymentMethod.config.isHostedFormEnabled === true;
    }

    private _isHostedFieldAvailable(options?: PaymentInitializeOptions): boolean {
        if (!options) {
            throw new InvalidArgumentError();
        }

        return (options.mollie?.form && options.mollie.form.fields) ? true : false;
    }

    private removeMollieComponents(): void {
        const mollieComponents = document.querySelectorAll('.mollie-component');

        each(mollieComponents, component => component.remove());

        const controllers = document.querySelectorAll('.mollie-components-controller');

        each(controllers, controller => controller.remove());
    }

    private _processAdditionalAction(error: any): Promise<InternalCheckoutSelectors> {
        if (!(error instanceof RequestError) || !some(error.body.errors, {code: 'additional_action_required'})) {
            return Promise.reject(error);
        }
        const { additional_action_required: { data : { redirect_url } } } = error.body;

        return new Promise(() => window.location.replace(redirect_url));
    }

    private _getInitializeOptions(): MolliePaymentInitializeOptions {
        if (!this._initializeOptions) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._initializeOptions;
    }

    private _loadMollieJs(merchantId: string, locale: string, testmode: boolean = false): Promise<MollieClient> {
        if (this._mollieClient) {
            return Promise.resolve(this._mollieClient);
        }

        return this._mollieScriptLoader
            .load(merchantId, locale, testmode);
    }

    private _getMollieClient(): MollieClient {
        if (!this._mollieClient) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._mollieClient;
    }

    /**
     * ContainerId is use in Mollie for determined either its showing or not the
     * container, because when Mollie has Vaulted Instruments it gets hide,
     * and shows an error because can't mount Provider Components
     *
     * We had to add a settimeout because Mollie sets de tab index after mounting
     * each component, but without a setTimeOut Mollie is not able to find the
     * components as they are hidden so we need to wait until they are shown
     */
    private _mountElements() {
        const { containerId, cardNumberId, cardCvcId, cardExpiryId, cardHolderId, styles } = this._getInitializeOptions();
        let container: HTMLElement | null;

        if (containerId) {
            container = document.getElementById(containerId);
        }

        setTimeout(() => {
            if (!containerId || container?.style.display !== 'none') {
                const mollieClient = this._getMollieClient();

                this._cardHolderElement = mollieClient.createComponent('cardHolder', { styles });
                this._cardHolderElement.mount(`#${cardHolderId}`);

                this._cardNumberElement = mollieClient.createComponent('cardNumber', { styles });
                this._cardNumberElement.mount(`#${cardNumberId}`);

                this._verificationCodeElement = mollieClient.createComponent('verificationCode', { styles });
                this._verificationCodeElement.mount(`#${cardCvcId}`);

                this._expiryDateElement = mollieClient.createComponent('expiryDate', { styles });
                this._expiryDateElement.mount(`#${cardExpiryId}`);
            }
        }, 0);
    }
}
