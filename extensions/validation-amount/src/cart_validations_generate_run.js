// @ts-check

const GWP_CONDITIONS = [
  {
    currencyCode: "SGD",
    thresholdAmount: 150,
    giftProductId: "gid://shopify/Product/9993633431866",
  },
  {
    currencyCode: "MYR",
    thresholdAmount: 465,
    giftProductId: "gid://shopify/Product/9993633431866",
  },
  {
    currencyCode: "SGD",
    thresholdAmount: 200,
    giftProductId: "gid://shopify/Product/9948721316154",
  },
  {
    currencyCode: "MYR",
    thresholdAmount: 620,
    giftProductId: "gid://shopify/Product/9948721316154",
  },
];

const ERROR_MESSAGE =
  "If no gift is selected, a random item will be sent. Please note that exchanges or returns due to this are not accepted.";

export function cartValidationsGenerateRun(input) {
  const step = input.buyerJourney?.step;
  const VALIDATE_STEPS = ["CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION"];

  if (!VALIDATE_STEPS.includes(step)) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // 테스트 고객만 validation 동작
  const tagResults = input?.cart?.buyerIdentity?.customer?.hasTags ?? [];
  const isTestCustomer = tagResults.some(
    (tag) => tag?.tag === "gwp-test" && tag?.hasTag === true
  );

  if (!isTestCustomer) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // ── 메타오브젝트에서 conditionTypes, 캠페인 기간 읽기 ────────

  const metaobject = input?.shop?.metaobject;

  if (!metaobject) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  const conditionTypes = parseConditionTypes(metaobject?.condition_type?.value);

  if (!conditionTypes.includes("amount")) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  const isCampaignPeriod = input?.shop?.localTime?.isCampaignPeriod;

  if (!isCampaignPeriod) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // ── 카트 데이터 ──────────────────────────────────────────

  const totalAmount = Number(input?.cart?.cost?.totalAmount?.amount ?? 0);
  const currencyCode = input?.cart?.cost?.totalAmount?.currencyCode;
  const cartLines = input?.cart?.lines ?? [];

  const cartProductIds = cartLines
    .map((line) => {
      if (line?.merchandise?.__typename !== "ProductVariant") return null;
      return line?.merchandise?.product?.id ?? null;
    })
    .filter(Boolean);

  // ── currency 필터 후 threshold 내림차순 정렬 ──────────────

  const sortedConditions = [...GWP_CONDITIONS]
    .filter((c) => c.currencyCode === currencyCode)
    .sort((a, b) => (b.thresholdAmount || 0) - (a.thresholdAmount || 0));

  // ── 해당하는 tier의 gift가 카트에 있는지 확인 ────────────

  const eligibleCondition = sortedConditions.find(
    (condition) => totalAmount >= condition.thresholdAmount
  );

  if (!eligibleCondition) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  const hasGift = cartProductIds.includes(eligibleCondition.giftProductId);

  const errors = hasGift
    ? []
    : [{ message: ERROR_MESSAGE, target: "$.cart" }];

  return { operations: [{ validationAdd: { errors } }] };
}

// ── 유틸 함수 ───────────────────────────────────────────────

function parseConditionTypes(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [value];
  }
}