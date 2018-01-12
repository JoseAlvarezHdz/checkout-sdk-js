"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var CheckoutErrorSelector = (function () {
    function CheckoutErrorSelector(billingAddress, cart, countries, coupon, customer, giftCertificate, instruments, order, paymentMethods, quote, shippingAddress, shippingCountries, shippingOptions) {
        this._billingAddress = billingAddress;
        this._cart = cart;
        this._countries = countries;
        this._coupon = coupon;
        this._customer = customer;
        this._giftCertificate = giftCertificate;
        this._instruments = instruments;
        this._order = order;
        this._paymentMethods = paymentMethods;
        this._quote = quote;
        this._shippingAddress = shippingAddress;
        this._shippingCountries = shippingCountries;
        this._shippingOptions = shippingOptions;
    }
    CheckoutErrorSelector.prototype.getError = function () {
        return this.getLoadCheckoutError() ||
            this.getSubmitOrderError() ||
            this.getFinalizeOrderError() ||
            this.getLoadOrderError() ||
            this.getLoadCartError() ||
            this.getVerifyCartError() ||
            this.getLoadBillingCountriesError() ||
            this.getLoadShippingCountriesError() ||
            this.getLoadPaymentMethodsError() ||
            this.getLoadPaymentMethodError() ||
            this.getLoadShippingOptionsError() ||
            this.getSelectShippingOptionError() ||
            this.getSignInError() ||
            this.getSignOutError() ||
            this.getUpdateBillingAddressError() ||
            this.getUpdateShippingAddressError() ||
            this.getApplyCouponError() ||
            this.getRemoveCouponError() ||
            this.getApplyGiftCertificateError() ||
            this.getRemoveGiftCertificateError() ||
            this.getLoadInstrumentsError() ||
            this.getDeleteInstrumentError() ||
            this.getVaultInstrumentError();
    };
    CheckoutErrorSelector.prototype.getLoadCheckoutError = function () {
        return this._quote.getLoadError();
    };
    CheckoutErrorSelector.prototype.getSubmitOrderError = function () {
        return this._order.getSubmitError();
    };
    CheckoutErrorSelector.prototype.getFinalizeOrderError = function () {
        return this._order.getFinalizeError();
    };
    CheckoutErrorSelector.prototype.getLoadOrderError = function () {
        return this._order.getLoadError();
    };
    CheckoutErrorSelector.prototype.getLoadCartError = function () {
        return this._cart.getLoadError();
    };
    CheckoutErrorSelector.prototype.getVerifyCartError = function () {
        return this._cart.getVerifyError();
    };
    CheckoutErrorSelector.prototype.getLoadBillingCountriesError = function () {
        return this._countries.getLoadError();
    };
    CheckoutErrorSelector.prototype.getLoadShippingCountriesError = function () {
        return this._shippingCountries.getLoadError();
    };
    CheckoutErrorSelector.prototype.getLoadPaymentMethodsError = function () {
        return this._paymentMethods.getLoadError();
    };
    CheckoutErrorSelector.prototype.getLoadPaymentMethodError = function (methodId) {
        return this._paymentMethods.getLoadMethodError(methodId);
    };
    CheckoutErrorSelector.prototype.getSignInError = function () {
        return this._customer.getSignInError();
    };
    CheckoutErrorSelector.prototype.getSignOutError = function () {
        return this._customer.getSignOutError();
    };
    CheckoutErrorSelector.prototype.getLoadShippingOptionsError = function () {
        return this._shippingOptions.getLoadError();
    };
    CheckoutErrorSelector.prototype.getSelectShippingOptionError = function () {
        return this._shippingOptions.getSelectError();
    };
    CheckoutErrorSelector.prototype.getUpdateBillingAddressError = function () {
        return this._billingAddress.getUpdateError();
    };
    CheckoutErrorSelector.prototype.getUpdateShippingAddressError = function () {
        return this._shippingAddress.getUpdateError();
    };
    CheckoutErrorSelector.prototype.getApplyCouponError = function () {
        return this._coupon.getApplyError();
    };
    CheckoutErrorSelector.prototype.getRemoveCouponError = function () {
        return this._coupon.getRemoveError();
    };
    CheckoutErrorSelector.prototype.getApplyGiftCertificateError = function () {
        return this._giftCertificate.getApplyError();
    };
    CheckoutErrorSelector.prototype.getRemoveGiftCertificateError = function () {
        return this._giftCertificate.getRemoveError();
    };
    CheckoutErrorSelector.prototype.getLoadInstrumentsError = function () {
        return this._instruments.getLoadError();
    };
    CheckoutErrorSelector.prototype.getVaultInstrumentError = function () {
        return this._instruments.getVaultError();
    };
    CheckoutErrorSelector.prototype.getDeleteInstrumentError = function (instrumentId) {
        return this._instruments.getDeleteError(instrumentId);
    };
    return CheckoutErrorSelector;
}());
exports.default = CheckoutErrorSelector;
//# sourceMappingURL=checkout-error-selector.js.map