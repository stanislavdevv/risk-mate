import { useSearchParams } from "react-router";
import { parseLang, t } from "../i18n/strings";

export default function AdditionalPage() {
  const [params] = useSearchParams();
  const lang = parseLang(params.get("lang"));

  return (
    <s-page heading={t(lang, "additionalHeading")}>
      <s-section heading={t(lang, "additionalSectionHeading")}>
        <s-paragraph>
          {t(lang, "additionalPara1Before")}{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            {t(lang, "additionalPara1Link")}
          </s-link>
          {t(lang, "additionalPara1After")}
        </s-paragraph>
        <s-paragraph>
          {t(lang, "additionalPara2Before")} <code>app/routes</code>,{" "}
          {t(lang, "additionalPara2Between")} <code>&lt;ui-nav-menu&gt;</code>{" "}
          {t(lang, "additionalPara2After")} <code>app/routes/app.jsx</code>
          {t(lang, "additionalPara2End")}
        </s-paragraph>
      </s-section>
      <s-section slot="aside" heading={t(lang, "additionalResourcesHeading")}>
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              {t(lang, "additionalResourcesLink")}
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
