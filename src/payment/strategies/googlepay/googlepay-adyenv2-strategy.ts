import { getScriptLoader, getStylesheetLoader } from '@bigcommerce/script-loader';
import { some } from 'lodash';

import { HostedInstrument, Payment } from '../..';
import { CheckoutActionCreator, CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { getBrowserInfo } from '../../../common/browser-info';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType, RequestError } from '../../../common/error/errors';
import { bindDecorator as bind } from '../../../common/utility';
import { OrderActionCreator, OrderRequestBody } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategyActionCreator from '../../payment-strategy-action-creator';
import { AdyenAction, AdyenAdditionalAction, AdyenAdditionalActionState, AdyenClient, AdyenError, AdyenPaymentMethodType, AdyenV2ScriptLoader } from '../adyenv2';
import PaymentStrategy from '../payment-strategy';

import { GooglePaymentData, PaymentMethodData } from './googlepay';
import GooglePayPaymentInitializeOptions from './googlepay-initialize-options';
import GooglePayPaymentProcessor from './googlepay-payment-processor';

export default class GooglePayAdyenPaymentStrategy implements PaymentStrategy {
    private _googlePayOptions?: GooglePayPaymentInitializeOptions;
    private _methodId?: string;
    private _walletButton?: HTMLElement;
    private _adyenClient?: AdyenClient;
    private _scriptLoader: AdyenV2ScriptLoader;

    constructor(
        private _store: CheckoutStore,
        private _checkoutActionCreator: CheckoutActionCreator,
        private _googlePayPaymentProcessor: GooglePayPaymentProcessor,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _paymentStrategyActionCreator: PaymentStrategyActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _orderActionCreator: OrderActionCreator
    ) {
        const scriptLoader = getScriptLoader();
        this._scriptLoader = new AdyenV2ScriptLoader(scriptLoader, getStylesheetLoader());
    }

    initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        this._methodId = options.methodId;

        return this._googlePayPaymentProcessor.initialize(this._methodId)
            .then(async () => {
                const state = this._store.getState();
                const paymentMethod = state.paymentMethods.getPaymentMethodOrThrow(options.methodId);
                const storeConfig = state.config.getStoreConfig();

                if (!storeConfig) {
                    throw new MissingDataError(MissingDataErrorType.MissingCheckoutConfig);
                }

                const clientSideAuthentication = {
                    key: '',
                    value: '',
                };

                if (paymentMethod.initializationData.originKey) {
                    clientSideAuthentication.key = 'originKey';
                    clientSideAuthentication.value = paymentMethod.initializationData.originKey;
                } else {
                    clientSideAuthentication.key = 'clientKey';
                    clientSideAuthentication.value = paymentMethod.initializationData.clientKey;
                }

                this._adyenClient = await this._scriptLoader.load({
                    environment:  paymentMethod.config.testMode ? 'TEST' : ' PRODUCTION',
                    locale: storeConfig.storeProfile.storeLanguage,
                    [clientSideAuthentication.key]: clientSideAuthentication.value,
                    paymentMethodsResponse: paymentMethod.initializationData.paymentMethodsResponse,
                });

                this._googlePayOptions = this._getGooglePayOptions(options);

                if (!this._googlePayOptions) {
                    throw new InvalidArgumentError('Unable to initialize payment because "options.googlepay" argument is not provided.');
                }

                const walletButton = this._googlePayOptions.walletButton && document.getElementById(this._googlePayOptions.walletButton);

                if (walletButton) {
                    this._walletButton = walletButton;
                    this._walletButton.addEventListener('click', this._handleWalletButtonClick);
                }

                return state;
            });
    }

    deinitialize(): Promise<InternalCheckoutSelectors> {
        if (this._walletButton) {
            this._walletButton.removeEventListener('click', this._handleWalletButtonClick);
        }

        this._walletButton = undefined;

        return this._googlePayPaymentProcessor.deinitialize()
            .then(() => this._store.getState());
    }

    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._googlePayOptions) {
            throw new InvalidArgumentError('Unable to initialize payment because "options.googlepay" argument is not provided.');
        }

        const { payment } = payload;
        const paymentData = payment && payment.paymentData;
        const shouldSaveInstrument = paymentData && (paymentData as HostedInstrument).shouldSaveInstrument;
        const shouldSetAsDefaultInstrument = paymentData && (paymentData as HostedInstrument).shouldSetAsDefaultInstrument;

        const {
            onError = () => {},
            onPaymentSelect = () => {},
        } = this._googlePayOptions;

        return Promise.resolve(this._getPayment())
            .then(payment => {
                if (!payment.paymentData.nonce || !payment.paymentData.cardInformation) {
                    // TODO: Find a way to share the code with _handleWalletButtonClick method
                    return this._googlePayPaymentProcessor.displayWallet()
                        .then(paymentData => this._paymentInstrumentSelected(paymentData))
                        .then(() => onPaymentSelect())
                        .then(() => this._getPayment())
                        .catch(error => {
                            if (error.statusCode !== 'CANCELED') {
                                onError(error);
                            }
                        });
                }

                return payment;
            })
            .then(() =>
                this._store.dispatch(this._orderActionCreator.submitOrder({ useStoreCredit: payload.useStoreCredit }, options))
                    .then(() => this._store.dispatch(this._paymentActionCreator.submitPayment(this._getPayment())))
                    .catch(error => this._processAdditionalAction(error, shouldSaveInstrument, shouldSetAsDefaultInstrument))
            );
    }

    finalize(): Promise<InternalCheckoutSelectors> {
        return Promise.reject(new OrderFinalizationNotRequiredError());
    }

    private async _processAdditionalAction(error: unknown, shouldSaveInstrument?: boolean, shouldSetAsDefaultInstrument?: boolean): Promise<InternalCheckoutSelectors> {
        if (!(error instanceof RequestError) || !some(error.body.errors, {code: 'additional_action_required'})) {
            return Promise.reject(error);
        }

        const payment = await this._handleAction(error.body.provider_data);

        try {
            return await this._store.dispatch(this._paymentActionCreator.submitPayment({
                ...payment,
                paymentData: {
                    ...payment.paymentData,
                    shouldSaveInstrument,
                    shouldSetAsDefaultInstrument,
                },
            }));
        } catch (error) {
            return this._processAdditionalAction(error, shouldSaveInstrument, shouldSetAsDefaultInstrument);
        }
    }

    private _handleAction(additionalAction: AdyenAdditionalAction): Promise<Payment> {
        return new Promise((resolve, reject) => {
            const adyenAction: AdyenAction = JSON.parse(additionalAction.action);

            const additionalActionComponent = this._getAdyenClient().createFromAction(adyenAction, {
                onAdditionalDetails: (additionalActionState: AdyenAdditionalActionState) => {
                    const paymentPayload = {
                        methodId: adyenAction.paymentMethodType,
                        paymentData: {
                            nonce: JSON.stringify(additionalActionState.data),
                        },
                    };

                    resolve(paymentPayload);
                },
                size: '05',
                onError: (error: AdyenError) => reject(error),
            });

            additionalActionComponent.mount(`.checkout-view-header`);
        });
    }

    private _getAdyenClient(): AdyenClient {
        if (!this._adyenClient) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._adyenClient;
    }

    private _getGooglePayOptions(options: PaymentInitializeOptions): GooglePayPaymentInitializeOptions {
        if (options.methodId === 'googlepayadyenv2' && options.googlepayadyenv2) {
            return options.googlepayadyenv2;
        }

        throw new InvalidArgumentError();
    }

    private _getPayment(): PaymentMethodData {
        if (!this._methodId) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        const state = this._store.getState();
        const paymentMethod = state.paymentMethods.getPaymentMethod(this._methodId);

        if (!paymentMethod) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        if (!paymentMethod.initializationData.nonce) {
            throw new MissingDataError(MissingDataErrorType.MissingPayment);
        }

        let nonce;

        if (this._methodId === 'googlepayadyenv2') {
            nonce = JSON.stringify({
                type: AdyenPaymentMethodType.GooglePay,
                googlePayToken: paymentMethod.initializationData.nonce,
                browser_info: getBrowserInfo(),
            });
        } else {
            nonce = paymentMethod.initializationData.nonce;
        }

        const paymentData = {
            method: this._methodId,
            nonce,
            cardInformation: paymentMethod.initializationData.card_information,
        };

        return {
            methodId: this._methodId,
            paymentData,
        };
    }

    @bind
    private _handleWalletButtonClick(event: Event): Promise<InternalCheckoutSelectors> {
        event.preventDefault();

        if (!this._methodId || !this._googlePayOptions) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        const {
            onError = () => {},
            onPaymentSelect = () => {},
        } = this._googlePayOptions;

        return this._store.dispatch(this._paymentStrategyActionCreator.widgetInteraction(() => {
            return this._googlePayPaymentProcessor.displayWallet()
                .then(paymentData => this._paymentInstrumentSelected(paymentData))
                .then(() => onPaymentSelect())
                .catch(error => {
                    if (error.statusCode !== 'CANCELED') {
                        onError(error);
                    }
                });
        }, { methodId: this._methodId }), { queueId: 'widgetInteraction' });
    }

    private async _paymentInstrumentSelected(paymentData: GooglePaymentData) {
        if (!this._methodId) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        const methodId = this._methodId;

        // TODO: Revisit how we deal with GooglePaymentData after receiving it from Google
        await this._googlePayPaymentProcessor.handleSuccess(paymentData);

        return await Promise.all([
            this._store.dispatch(this._checkoutActionCreator.loadCurrentCheckout()),
            this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId)),
        ]);
    }
}
