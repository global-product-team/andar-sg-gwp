// @ts-check

/**
 * 조건 설정값
 * conditionTypes는 메타오브젝트에서 읽어옴
 * productId, giftProductId는 하드코딩 유지
 */
const GWP_CONDITIONS = [
  {
    currencyCode: "SGD",
    thresholdAmount: 100,
    productId: "gid://shopify/Product/XXXXXXXXX",
    productQuantity: 2,
    giftProductId: "gid://shopify/Product/XXXXXXXXX",
  },
  {
    currencyCode: "MYR",
    thresholdAmount: 300,
    productId: "gid://shopify/Product/XXXXXXXXX",
    productQuantity: 2,
    giftProductId: "gid://shopify/Product/XXXXXXXXX",
  },
];

const ERROR_MESSAGE = "error product message.";

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

  if (!conditionTypes.includes("product")) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  const isCampaignPeriod = input?.shop?.localTime?.isCampaignPeriod;

  if (!isCampaignPeriod) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // ── 카트 데이터 ──────────────────────────────────────────

  const currencyCode = input?.cart?.cost?.totalAmount?.currencyCode;
  const cartLines = input?.cart?.lines ?? [];
  const totalAmount = cartLines.reduce((sum, line) => {
    if (line?.merchandise?.__typename !== "ProductVariant") return sum;
    return sum + Number(line?.cost?.totalAmount?.amount || 0);
  }, 0);

  // ── eligible condition 찾기 ──────────────────────────────

  const sortedConditions = [...GWP_CONDITIONS]
    .filter((c) => c.currencyCode === currencyCode)
    .sort((a, b) => {
      const amountDiff = (b.thresholdAmount || 0) - (a.thresholdAmount || 0);
      if (amountDiff !== 0) return amountDiff;
      return (b.productQuantity || 0) - (a.productQuantity || 0);
    });

  const eligibleCondition = sortedConditions.find((condition) => {
    // ── amount 조건 ──────────────────────────────────────
    const amountOk = (() => {
      if (!conditionTypes.includes("amount")) return true;
      return totalAmount >= (condition.thresholdAmount || 0);
    })();

    if (!amountOk) return false;

    // ── product 수량 조건 ─────────────────────────────────
    const productOk = (() => {
      if (!condition.productId) return false;

      const productQty = cartLines.reduce((sum, line) => {
        if (line?.merchandise?.__typename !== "ProductVariant") return sum;
        if (line?.merchandise?.product?.id !== condition.productId) return sum;
        return sum + Number(line.quantity || 0);
      }, 0);

      return productQty >= (condition.productQuantity || 1);
    })();

    return productOk;
  });

  if (!eligibleCondition) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // ── gift product 카트 여부 확인 ───────────────────────────

  const cartProductIds = cartLines
    .map((line) => {
      if (line?.merchandise?.__typename !== "ProductVariant") return null;
      return line?.merchandise?.product?.id ?? null;
    })
    .filter(Boolean);

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