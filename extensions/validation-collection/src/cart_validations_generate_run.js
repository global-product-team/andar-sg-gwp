// @ts-check

/**
 * 조건 설정값
 *
 * conditionTypes: ["collection"] | ["amount", "collection"]
 *
 * conditions 배열 — 순서 무관 (thresholdAmount → collectionQuantity 내림차순 자동 정렬)
 *
 * ex1) amount + collection
 * {
 *   currencyCode: "SGD",
 *   thresholdAmount: 100,
 *   collectionId: "gid://shopify/Collection/xxx",
 *   collectionQuantity: 1,
 *   giftProductId: "gid://shopify/Product/xxx",
 * }
 *
 * ex2) collection만
 * {
 *   collectionId: "gid://shopify/Collection/xxx",
 *   collectionQuantity: 2,
 *   giftProductId: "gid://shopify/Product/xxx",
 * }
 */
const GWP_CONFIG = {
  conditionTypes: ["amount", "collection"],
  conditions: [
    {
      currencyCode: "SGD",
      thresholdAmount: 30,
      collectionId: "gid://shopify/Collection/499615138106",
      collectionQuantity: 1,
      giftProductId: "gid://shopify/Product/10143139397946",
    },    
    {
      currencyCode: "MYR",
      thresholdAmount: 400,
      collectionId: "gid://shopify/Collection/447626903866",
      collectionQuantity: 1,
      giftProductId: "gid://shopify/Product/10143139397946",
    },
  ],
};

const ERROR_MESSAGE =
  "error message";

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

  const totalAmount = Number(input?.cart?.cost?.totalAmount?.amount ?? 0);
  const currencyCode = input?.cart?.cost?.totalAmount?.currencyCode;
  const cartLines = input?.cart?.lines ?? [];
  const conditionTypes = GWP_CONFIG.conditionTypes;

  // 통화 필터링 후 높은 티어부터 자동 정렬
  const sortedConditions = [...GWP_CONFIG.conditions]
    .filter((c) => {
      if (conditionTypes.includes("amount")) {
        return c.currencyCode === currencyCode;
      }
      return true;
    })
    .sort((a, b) => {
      const amountDiff = (b.thresholdAmount || 0) - (a.thresholdAmount || 0);
      if (amountDiff !== 0) return amountDiff;
      return (b.collectionQuantity || 0) - (a.collectionQuantity || 0);
    });

  // eligible condition 찾기
  const eligibleCondition = sortedConditions.find((condition) => {
    // amount 조건 체크
    const amountOk =
      !conditionTypes.includes("amount") ||
      totalAmount >= (condition.thresholdAmount || 0);

    // collection 조건 체크
    const collectionOk = !conditionTypes.includes("collection") || (() => {
      if (!condition.collectionId) return false;

      const collectionQty = cartLines.reduce((sum, line) => {
        if (line?.merchandise?.__typename !== "ProductVariant") return sum;

        const inCollections = line?.merchandise?.product?.inCollections || [];
        const isMember = inCollections.some(
          (c) => c.collectionId === condition.collectionId && c.isMember === true
        );

        return isMember ? sum + Number(line.quantity || 0) : sum;
      }, 0);

      return collectionQty >= (condition.collectionQuantity || 1);
    })();

    return amountOk && collectionOk;
  });

  // eligible condition 없으면 통과
  if (!eligibleCondition) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // gift product가 카트에 있는지 확인
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