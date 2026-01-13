// app/strings.ts
export type Lang = "en" | "de" | "es" | "fr" | "ru";

type Dict = Record<string, string>;
type Dictionaries = Record<Lang, Dict>;

export const SUPPORTED_LANGS: Lang[] = ["en", "de", "es", "fr", "ru"];
export function parseLang(raw: string | null): Lang {
    const v = String(raw ?? "en").toLowerCase().trim();
    if (SUPPORTED_LANGS.includes(v as Lang)) return v as Lang;
    return "en";
}
export const STRINGS: Dictionaries = {
    en: {
        appName: "RiskMate",
        storeCurrency: "Store currency",
        tabOrders: "Orders",
        tabRules: "Rules",

        setupChecklistTitle: "Setup checklist",
        setupChecklistSubtitle: "2 steps to start seeing consistent risk checks.",
        setup: "Setup",
        createRulesTitle: "Create rules",
        createRulesDone: "Rules are configured.",
        createRulesTodo: "Go to Rules tab and add your first rules.",
        receiveWebhooksTitle: "Receive webhook events",
        receiveWebhooksDone: "Webhook events are arriving and checks are being saved.",
        receiveWebhooksTodo: "Create a test order and update it to trigger orders/create and orders/updated.",
        quickLink: "Quick link",
        openOrdersInAdmin: "Open Orders in Admin",

        ordersTitle: "Orders",
        all: "All",
        high: "High",
        medium: "Medium",
        low: "Low",

        noChecksYetTitle: "Nothing here yet",
        noChecksYetText: "No checks yet. Create or update a test order to trigger webhooks.",

        thLastEvent: "Last event",
        thUpdated: "Updated",
        thOrder: "Order",
        thScore: "Score",
        thRisk: "Risk",
        thTopReasons: "Top reasons",
        thLink: "Link",
        open: "Open",

        riskChanged: "Risk changed",
        decision: "Decision",

        rulesTitle: "Rules",
        rulesSubtitle: "Inline edit · thresholds are in",
        saved: "Saved",
        saving: "Saving…",
        error: "Error",
        idleDash: "—",

        noRulesYetText: "No rules yet. Add your first rule below.",
        addDefaultRules: "Add default rules",
        addingDefaults: "Adding defaults…",

        addRuleTitle: "Add rule",
        addRuleBtn: "Add rule",
        addingRule: "Adding…",

        type: "Type",
        operator: "Operator",
        value: "Value",
        points: "Points",
        action: "Action",
        enabled: "Enabled",
        delete: "Delete",

        on: "On",
        off: "Off",

        deleteConfirm: "Delete this rule?",

        examples: "Examples",
        recentEventsTitle: "Recent events",
        recentEventsSubtitle: "Last 20 webhooks received",
        noEventsYet: "No events yet.",
        evTime: "Time",
        evTopic: "Topic",
        evOrder: "Order",
        evDecision: "Decision",
    },

    de: {
        appName: "RiskMate",
        storeCurrency: "Shop-Währung",
        tabOrders: "Bestellungen",
        tabRules: "Regeln",

        setupChecklistTitle: "Setup-Checkliste",
        setupChecklistSubtitle: "2 Schritte, um konsistente Risiko-Checks zu sehen.",
        setup: "Setup",
        createRulesTitle: "Regeln erstellen",
        createRulesDone: "Regeln sind konfiguriert.",
        createRulesTodo: "Zum Tab „Regeln“ gehen und erste Regeln hinzufügen.",
        receiveWebhooksTitle: "Webhook-Events empfangen",
        receiveWebhooksDone: "Webhooks kommen an und Checks werden gespeichert.",
        receiveWebhooksTodo: "Testbestellung erstellen und updaten (orders/create + orders/updated).",
        quickLink: "Schnelllink",
        openOrdersInAdmin: "Bestellungen im Admin öffnen",

        ordersTitle: "Bestellungen",
        all: "Alle",
        high: "Hoch",
        medium: "Mittel",
        low: "Niedrig",

        noChecksYetTitle: "Noch nichts hier",
        noChecksYetText: "Noch keine Checks. Erstelle oder update eine Testbestellung, um Webhooks auszulösen.",

        thLastEvent: "Letztes Event",
        thUpdated: "Aktualisiert",
        thOrder: "Bestellung",
        thScore: "Score",
        thRisk: "Risiko",
        thTopReasons: "Top-Gründe",
        thLink: "Link",
        open: "Öffnen",

        riskChanged: "Risiko geändert",
        decision: "Entscheidung",

        rulesTitle: "Regeln",
        rulesSubtitle: "Inline-Edit · Schwellenwerte in",
        saved: "Gespeichert",
        saving: "Speichern…",
        error: "Fehler",
        idleDash: "—",

        noRulesYetText: "Noch keine Regeln. Füge unten die erste Regel hinzu.",
        addDefaultRules: "Standardregeln hinzufügen",
        addingDefaults: "Standardregeln…",

        addRuleTitle: "Regel hinzufügen",
        addRuleBtn: "Regel hinzufügen",
        addingRule: "Hinzufügen…",

        type: "Typ",
        operator: "Operator",
        value: "Wert",
        points: "Punkte",
        action: "Aktion",
        enabled: "Aktiv",
        delete: "Löschen",

        on: "An",
        off: "Aus",

        deleteConfirm: "Diese Regel löschen?",

        examples: "Beispiele",
        recentEventsTitle: "Letzte Events",
        recentEventsSubtitle: "Letzte 20 Webhooks",
        noEventsYet: "Noch keine Events.",
        evTime: "Zeit",
        evTopic: "Topic",
        evOrder: "Bestellung",
        evDecision: "Entscheidung",
    },

    es: {
        appName: "RiskMate",
        storeCurrency: "Moneda de la tienda",
        tabOrders: "Pedidos",
        tabRules: "Reglas",
        setupChecklistTitle: "Lista de configuración",
        setupChecklistSubtitle: "2 pasos para ver comprobaciones consistentes.",
        setup: "Config",
        createRulesTitle: "Crear reglas",
        createRulesDone: "Reglas configuradas.",
        createRulesTodo: "Ve a Reglas y añade tus primeras reglas.",
        receiveWebhooksTitle: "Recibir webhooks",
        receiveWebhooksDone: "Los webhooks llegan y se guardan checks.",
        receiveWebhooksTodo: "Crea un pedido de prueba y actualízalo (orders/create + orders/updated).",
        quickLink: "Enlace rápido",
        openOrdersInAdmin: "Abrir pedidos en Admin",

        ordersTitle: "Pedidos",
        all: "Todos",
        high: "Alto",
        medium: "Medio",
        low: "Bajo",

        noChecksYetTitle: "Aún no hay nada",
        noChecksYetText: "Aún no hay checks. Crea o actualiza un pedido de prueba para disparar webhooks.",

        thLastEvent: "Último evento",
        thUpdated: "Actualizado",
        thOrder: "Pedido",
        thScore: "Puntuación",
        thRisk: "Riesgo",
        thTopReasons: "Motivos",
        thLink: "Enlace",
        open: "Abrir",

        riskChanged: "Riesgo cambió",
        decision: "Decisión",

        rulesTitle: "Reglas",
        rulesSubtitle: "Edición inline · umbrales en",
        saved: "Guardado",
        saving: "Guardando…",
        error: "Error",
        idleDash: "—",

        noRulesYetText: "Aún no hay reglas. Añade tu primera regla abajo.",
        addDefaultRules: "Añadir reglas por defecto",
        addingDefaults: "Añadiendo…",

        addRuleTitle: "Añadir regla",
        addRuleBtn: "Añadir regla",
        addingRule: "Añadiendo…",

        type: "Tipo",
        operator: "Operador",
        value: "Valor",
        points: "Puntos",
        action: "Acción",
        enabled: "Activo",
        delete: "Borrar",

        on: "On",
        off: "Off",

        deleteConfirm: "¿Borrar esta regla?",

        examples: "Ejemplos",
        recentEventsTitle: "Eventos recientes",
        recentEventsSubtitle: "Últimos 20 webhooks",
        noEventsYet: "Aún no hay eventos.",
        evTime: "Hora",
        evTopic: "Topic",
        evOrder: "Pedido",
        evDecision: "Decisión",
    },

    fr: {
        appName: "RiskMate",
        storeCurrency: "Devise de la boutique",
        tabOrders: "Commandes",
        tabRules: "Règles",
        setupChecklistTitle: "Checklist de configuration",
        setupChecklistSubtitle: "2 étapes pour voir des contrôles cohérents.",
        setup: "Setup",
        createRulesTitle: "Créer des règles",
        createRulesDone: "Règles configurées.",
        createRulesTodo: "Aller à l’onglet Règles et ajouter les premières règles.",
        receiveWebhooksTitle: "Recevoir des webhooks",
        receiveWebhooksDone: "Les webhooks arrivent et les checks sont enregistrés.",
        receiveWebhooksTodo: "Créer une commande de test et la mettre à jour (orders/create + orders/updated).",
        quickLink: "Lien rapide",
        openOrdersInAdmin: "Ouvrir les commandes dans l’Admin",

        ordersTitle: "Commandes",
        all: "Toutes",
        high: "Élevé",
        medium: "Moyen",
        low: "Faible",

        noChecksYetTitle: "Rien pour l’instant",
        noChecksYetText: "Pas encore de checks. Crée ou mets à jour une commande de test pour déclencher les webhooks.",

        thLastEvent: "Dernier événement",
        thUpdated: "Mis à jour",
        thOrder: "Commande",
        thScore: "Score",
        thRisk: "Risque",
        thTopReasons: "Raisons",
        thLink: "Lien",
        open: "Ouvrir",

        riskChanged: "Risque modifié",
        decision: "Décision",

        rulesTitle: "Règles",
        rulesSubtitle: "Édition inline · seuils en",
        saved: "Enregistré",
        saving: "Enregistrement…",
        error: "Erreur",
        idleDash: "—",

        noRulesYetText: "Pas encore de règles. Ajoute ta première règle ci-dessous.",
        addDefaultRules: "Ajouter les règles par défaut",
        addingDefaults: "Ajout…",

        addRuleTitle: "Ajouter une règle",
        addRuleBtn: "Ajouter",
        addingRule: "Ajout…",

        type: "Type",
        operator: "Opérateur",
        value: "Valeur",
        points: "Points",
        action: "Action",
        enabled: "Actif",
        delete: "Supprimer",

        on: "On",
        off: "Off",

        deleteConfirm: "Supprimer cette règle ?",

        examples: "Exemples",
        recentEventsTitle: "Événements récents",
        recentEventsSubtitle: "20 derniers webhooks",
        noEventsYet: "Pas encore d’événements.",
        evTime: "Heure",
        evTopic: "Topic",
        evOrder: "Commande",
        evDecision: "Décision",
    },

    ru: {
        appName: "RiskMate",
        storeCurrency: "Валюта магазина",
        tabOrders: "Заказы",
        tabRules: "Правила",

        setupChecklistTitle: "Чеклист настройки",
        setupChecklistSubtitle: "2 шага, чтобы видеть стабильные риск-проверки.",
        setup: "Setup",
        createRulesTitle: "Создать правила",
        createRulesDone: "Правила настроены.",
        createRulesTodo: "Открой вкладку Rules и добавь первые правила.",
        receiveWebhooksTitle: "Получать вебхуки",
        receiveWebhooksDone: "Вебхуки приходят, проверки сохраняются.",
        receiveWebhooksTodo: "Создай тестовый заказ и обнови его (orders/create + orders/updated).",
        quickLink: "Быстрая ссылка",
        openOrdersInAdmin: "Открыть Orders в админке",

        ordersTitle: "Заказы",
        all: "Все",
        high: "High",
        medium: "Medium",
        low: "Low",

        noChecksYetTitle: "Пока пусто",
        noChecksYetText: "Проверок ещё нет. Создай/обнови тестовый заказ, чтобы сработали вебхуки.",

        thLastEvent: "Last event",
        thUpdated: "Updated",
        thOrder: "Order",
        thScore: "Score",
        thRisk: "Risk",
        thTopReasons: "Top reasons",
        thLink: "Link",
        open: "Open",

        riskChanged: "Risk changed",
        decision: "Decision",

        rulesTitle: "Rules",
        rulesSubtitle: "Inline edit · thresholds are in",
        saved: "Saved",
        saving: "Saving…",
        error: "Error",
        idleDash: "—",

        noRulesYetText: "Правил ещё нет. Добавь первое правило ниже.",
        addDefaultRules: "Добавить дефолтные правила",
        addingDefaults: "Добавляю…",

        addRuleTitle: "Add rule",
        addRuleBtn: "Add rule",
        addingRule: "Adding…",

        type: "Type",
        operator: "Operator",
        value: "Value",
        points: "Points",
        action: "Action",
        enabled: "Enabled",
        delete: "Delete",

        on: "On",
        off: "Off",

        deleteConfirm: "Удалить это правило?",

        examples: "Examples",
        recentEventsTitle: "Recent events",
        recentEventsSubtitle: "Last 20 webhooks received",
        noEventsYet: "No events yet.",
        evTime: "Time",
        evTopic: "Topic",
        evOrder: "Order",
        evDecision: "Decision",
    },
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>) {
    const dict = STRINGS[lang] ?? STRINGS.en;
    let s = dict[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            s = s.replaceAll(`{${k}}`, String(v));
        }
    }
    return s;
}
