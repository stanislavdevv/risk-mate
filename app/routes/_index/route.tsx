import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { parseLang, t, type Lang } from "../../i18n/strings";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const lang = parseLang(url.searchParams.get("lang"));

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login), lang };
};

export default function App() {
  const { showForm, lang } = useLoaderData<typeof loader>() as { showForm: boolean; lang: Lang };
  const langQuery = lang ? `?lang=${encodeURIComponent(lang)}` : "";

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{t(lang, "landingHeading")}</h1>
        <p className={styles.text}>
          {t(lang, "landingTagline")}
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action={`/auth/login${langQuery}`}>
            <label className={styles.label}>
              <span>{t(lang, "shopDomainLabel")}</span>
              <input className={styles.input} type="text" name="shop" />
              <span>{t(lang, "landingShopExample")}</span>
            </label>
            <button className={styles.button} type="submit">
              {t(lang, "loginButton")}
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>{t(lang, "landingFeatureTitle")}</strong>. {t(lang, "landingFeatureDetail")}
          </li>
          <li>
            <strong>{t(lang, "landingFeatureTitle")}</strong>. {t(lang, "landingFeatureDetail")}
          </li>
          <li>
            <strong>{t(lang, "landingFeatureTitle")}</strong>. {t(lang, "landingFeatureDetail")}
          </li>
        </ul>
      </div>
    </div>
  );
}
