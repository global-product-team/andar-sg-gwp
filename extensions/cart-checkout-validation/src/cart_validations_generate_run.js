// @ts-check

const LEGGINGS_UNDERWEAR_PRODUCT_ID = "gid://shopify/Product/9993633431866";
const BEACH_BAG_PRODUCT_ID = "gid://shopify/Product/9948721316154";

const TIERS = {
  SGD: {
    tier150: 150,
    tier200: 200,
  },

  MYR: {
    tier150: 465,
    tier200: 620,
  },
};

const ERROR_MESSAGE =
  "If no gift is selected, a random item will be sent. Please note that exchanges or returns due to this are not accepted.";


export function cartValidationsGenerateRun(input) {
  const step = input.buyerJourney?.step;

  const VALIDATE_STEPS = ["CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION"];

  if (!VALIDATE_STEPS.includes(step)) {
    return { operations: [{ validationAdd: { errors: [] } }] };
  }

  // // test
  // const tagResults = input?.cart?.buyerIdentity?.customer?.hasTags ?? [];
  // const isTestCustomer = tagResults.some(
  //   (tag) => tag?.tag === "gwp-test" && tag?.hasTag === true
  // );

  // if (!isTestCustomer) {
  //   return { operations: [{ validationAdd: { errors: [] } }] };
  // }

  const totalAmount = Number(input?.cart?.cost?.totalAmount?.amount ?? 0);
  const currencyCode = input?.cart?.cost?.totalAmount?.currencyCode;

  const productIdsInCart = (input?.cart?.lines ?? [])
    .map((line) => {
      const merchandise = line?.merchandise;
      if (merchandise?.__typename !== "ProductVariant") return null;
      return merchandise?.product?.id ?? null;
    })
    .filter(Boolean);

  const hasLeggingsUnderwear = productIdsInCart.includes(LEGGINGS_UNDERWEAR_PRODUCT_ID);
  const hasBeachBag = productIdsInCart.includes(BEACH_BAG_PRODUCT_ID);

  const errors = [];

  const tier = TIERS[currencyCode];

  if (tier) {
    if (
      totalAmount >= tier.tier200 &&
      !hasBeachBag
    ) {
      errors.push({
        message: ERROR_MESSAGE,
        target: "$.cart",
      });
    } else if (
      totalAmount >= tier.tier150 &&
      totalAmount < tier.tier200 &&
      !hasLeggingsUnderwear
    ) {
      errors.push({
        message: ERROR_MESSAGE,
        target: "$.cart",
      });
    }
  }

  return { operations: [{ validationAdd: { errors } }] };
}