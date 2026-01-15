import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { parseLang, t, type Lang } from "../../i18n/strings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));
  const errors = loginErrorMessage(await login(request), lang);

  return { errors, lang };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));
  const errors = loginErrorMessage(await login(request), lang);

  return {
    errors,
    lang,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;
  const lang = (actionData?.lang ?? loaderData.lang) as Lang;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
        <s-section heading={t(lang, "loginTitle")}>
          <s-text-field
            name="shop"
            label={t(lang, "shopDomainLabel")}
            details={t(lang, "shopDomainDetails")}
            value={shop}
            onChange={(e) => setShop(e.currentTarget.value)}
            autocomplete="on"
            error={errors.shop}
          ></s-text-field>
          <s-button type="submit">{t(lang, "loginButton")}</s-button>
        </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
