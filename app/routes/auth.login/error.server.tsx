import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";
import type { Lang } from "../../i18n/strings";
import { t } from "../../i18n/strings";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError, lang: Lang): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: t(lang, "loginErrorMissingShop") };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: t(lang, "loginErrorInvalidShop") };
  }

  return {};
}
