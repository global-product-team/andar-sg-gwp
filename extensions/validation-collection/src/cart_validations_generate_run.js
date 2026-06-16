// @ts-check

/**
 * 조건 설정값
 * conditionTypes는 메타오브젝트에서 읽어옴
 * collectionId, giftProductId는 하드코딩 유지
 * inCollections ids도 run.graphql에 동일하게 유지
 */
const GWP_CONDITIONS = [
  { //men
    currencyCode: "SGD",
    thresholdAmount: 80,
    collectionId: "gid://shopify/Collection/499615138106",
    collectionOnly: false,
    collectionQuantity: 1,
    giftProductId: "gid://shopify/Product/10143139397946",
  },    
  {//women bottom
    currencyCode: "MYR",
    thresholdAmount: 400,
    collectionId: "gid://shopify/Collection/447626903866",
    collectionOnly: false,
    collectionQuantity: 2,
    giftProductId: "gid://shopify/Product/10143139397946",
  },
];

const ERROR_MESSAGE =
  "error message.";
  

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

  if (!conditionTypes.length) {
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

  // ── eligible condition 찾기 ──────────────────────────────

  const sortedConditions = [...GWP_CONDITIONS]
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

  const eligibleCondition = sortedConditions.find((condition) => {
    const amountOk = (() => {
      if (!conditionTypes.includes("amount")) return true;
      if (condition.collectionOnly) return true; // ← 추가
      return totalAmount >= (condition.thresholdAmount || 0);
    })();

    if (!amountOk) return false; // ← 추가 (early return)

    const collectionOk = (() => {
      if (!conditionTypes.includes("collection")) return true;
      if (!condition.collectionId) return false;

      if (condition.collectionOnly) {
        // ── collectionOnly: 컬렉션 상품 금액 합계로 threshold 체크 ──
        const cartTotal = Number(input?.cart?.cost?.totalAmount?.amount || 0);
        const cartLineTotal = cartLines.reduce((sum, line) => {
          return sum + Number(line?.cost?.totalAmount?.amount || 0);
        }, 0);
        const discountRatio = cartLineTotal > 0 ? cartTotal / cartLineTotal : 1;

        const collectionAmount = cartLines.reduce((sum, line) => {
          if (line?.merchandise?.__typename !== "ProductVariant") return sum;
          const inCollections = line?.merchandise?.product?.inCollections || [];
          const isMember = inCollections.some(
            (c) => c.collectionId === condition.collectionId && c.isMember === true
          );
          if (!isMember) return sum;
          const linePrice = Number(line?.cost?.totalAmount?.amount || 0);
          return sum + linePrice * discountRatio;
        }, 0);

        return collectionAmount >= (condition.thresholdAmount || 0);
      }

      // 기존 로직: 수량 체크
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

    return collectionOk; // ← amountOk는 위에서 이미 처리했으므로
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

