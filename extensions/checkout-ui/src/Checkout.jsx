import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  useCartLines,
  useTotalAmount,
  useInstructions,
  useBuyerJourneyIntercept,
} from "@shopify/ui-extensions/checkout/preact";

export default function extension() {
  render(<Extension />, document.body);
}

const GWP_HANDLE = "sg-11-th-anniversary-gwp";
const GWP_TYPE = "gwp";
const EGIFT_PRODUCT_ID = "gid://shopify/Product/9726266376506";

function Extension() {
  const cartLines = useCartLines();
  const total = useTotalAmount();
  const instructions = useInstructions();

  const [gwp, setGwp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariants, setSelectedVariants] = useState({});
  const isRemovingRef = useRef(false);
  const isNormalizingGiftQtyRef = useRef(false);

  const totalAmount = useMemo(() => {
    return cartLines.reduce((sum, line) => {
      if (line?.merchandise?.product?.id === EGIFT_PRODUCT_ID) return sum;
      return sum + Number(line?.cost?.totalAmount?.amount || 0);
    }, 0);
  }, [cartLines]);
  const currencyCode = total?.currencyCode;

  useEffect(() => {
    fetchGwp();
  }, []);

  const conditions = useMemo(() => {
    return gwp?.conditions || [];
  }, [gwp]);

  const conditionTypes = useMemo(() => {
    return gwp?.conditionTypes || [];
  }, [gwp]);

  const giftProductIds = useMemo(() => {
    return conditions
      .map((condition) => condition.giftProduct?.id)
      .filter(Boolean);
  }, [conditions]);


  const eligibleCondition = useMemo(() => {
    if (!gwp) return null;
    if (!isWithinCampaignPeriod(gwp.startDatetime, gwp.endDatetime)) return null;

    return conditions
      .filter((condition) => {
        const amountOk = !conditionTypes.includes("amount") ||
          (condition.currencyCode === currencyCode &&
            totalAmount >= Number(condition.thresholdAmount || 0));

        const productOk = !conditionTypes.includes("product") ||
         cartLines.filter(
            (line) => line?.merchandise?.product?.id === condition.product?.id
          ).reduce((sum, line) => sum + line.quantity, 0) >= Number(condition.productMinQuantity || 1);

        const collectionOk = !conditionTypes.includes("collection") || true; 

        return amountOk && productOk && collectionOk;
      })
      .sort((a, b) => {
        return Number(b.thresholdAmount || 0) - Number(a.thresholdAmount || 0);
      })[0] || null;
  }, [gwp, conditions, conditionTypes, totalAmount, currencyCode, cartLines]);

  const targetProduct = eligibleCondition?.giftProduct || null;
  const targetProductId = targetProduct?.id || null;

  const targetVariantId = useMemo(() => {
    if (!targetProduct) return null;

    const firstAvailableVariant =
      targetProduct.variants.nodes.find((variant) => variant.availableForSale) ||
      targetProduct.variants.nodes[0];

    return firstAvailableVariant?.id || null;
  }, [targetProduct]);

  const targetProductLine = getCartLineByProductId(targetProductId);

  function getCartLineByProductId(productId) {
    if (!productId) return null;

    return cartLines.find((line) => {
      return line?.merchandise?.product?.id === productId;
    });
  }

  function isGiftProduct(productId) {
    return giftProductIds.includes(productId);
  }

  function isGiftVariant(variantId) {
    return cartLines.some(
      (line) =>
        line?.merchandise?.id === variantId &&
        isGiftProduct(line?.merchandise?.product?.id)
    );
  }

  useEffect(() => {
    if (!targetProduct) {
      setSelectedVariants({});
      return;
    }

    if (targetVariantId) {
      setSelectedVariants({
        [targetProduct.id]: targetVariantId,
      });
    }
  }, [targetProduct, targetVariantId]);

  useEffect(() => {
    async function syncGiftTier() {
      if (isRemovingRef.current) return;

      if (!instructions?.lines?.canRemoveCartLine) {
        console.log("remove blocked by checkout instructions");
        return;
      }

      const giftLines = cartLines.filter((line) =>
        isGiftProduct(line?.merchandise?.product?.id)
      );

      const linesToRemove = giftLines.filter((line) => {
        const productId = line?.merchandise?.product?.id;

        if (!targetProductId) return true;
        return productId !== targetProductId;
      });

      if (!linesToRemove.length) return;

      isRemovingRef.current = true;

      try {
        for (const line of linesToRemove) {
          const result = await shopify.applyCartLinesChange({
            type: "removeCartLine",
            id: line.id,
            quantity: line.quantity,
          });

          console.log("remove invalid gift result", result);
        }
      } catch (error) {
        console.error("syncGiftTier remove error", error);
      } finally {
        isRemovingRef.current = false;
      }
    }

    syncGiftTier();
  }, [cartLines, giftProductIds, targetProductId, instructions]);

  useEffect(() => {
    async function normalizeGiftQuantity() {
      if (isNormalizingGiftQtyRef.current) return;
      if (!instructions?.lines?.canUpdateCartLine) return;

      const giftLines = cartLines.filter((line) =>
        isGiftProduct(line?.merchandise?.product?.id)
      );

      const linesToFix = giftLines.filter((line) => line.quantity > 1);

      if (!linesToFix.length) return;

      isNormalizingGiftQtyRef.current = true;

      try {
        for (const line of linesToFix) {
          const result = await shopify.applyCartLinesChange({
            type: "updateCartLine",
            id: line.id,
            quantity: 1,
          });

          console.log("normalize gift quantity result", result);
        }
      } catch (error) {
        console.error("normalizeGiftQuantity error", error);
      } finally {
        isNormalizingGiftQtyRef.current = false;
      }
    }

    normalizeGiftQuantity();
  }, [cartLines, giftProductIds, instructions]);

  async function fetchGwp() {
    const query = `
      query getGwp($handle: MetaobjectHandleInput!) {
        metaobject(handle: $handle) {
          id
          handle
          fields {
            key
            value
            references(first: 20) {
              nodes {
                ... on Metaobject {
                  id
                  handle
                  fields {
                    key
                    value
                    reference {
                      ... on Product {
                        id
                        title
                        featuredImage {
                          url
                          altText
                        }
                        variants(first: 50) {
                          nodes {
                            id
                            title
                            availableForSale
                            price {
                              amount
                              currencyCode
                            }
                            image {
                              url
                              altText
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const { data } = await shopify.query(query, {
        variables: {
          handle: {
            type: GWP_TYPE,
            handle: GWP_HANDLE,
          },
        },
      });

      const metaobject = data?.metaobject;

      if (!metaobject) {
        setGwp(null);
        setLoading(false);
        return;
      }

      console.log("GWP raw data", data); console.log("GWP parsed data", parseGwp(metaobject));
      setGwp(parseGwp(metaobject));
      setLoading(false);
    } catch (error) {
      console.error("fetchGwp error", error);
      setGwp(null);
      setLoading(false);
    }
  }

  function parseGwp(metaobject) {
    const fields = getFieldsMap(metaobject.fields);
    const conditionNodes =
      metaobject.fields.find((field) => field.key === "conditions")?.references?.nodes || [];

    return {
      id: metaobject.id,
      handle: metaobject.handle,
      title: fields.title,
      startDatetime: fields.start_datetime,
      endDatetime: fields.end_datetime,
      conditionTypes: JSON.parse(fields.condition_type || "[]"),
      conditions: conditionNodes.map(parseCondition),
    };
  }

  function parseCondition(metaobject) {
    const fields = getFieldsMap(metaobject.fields);

    return {
      id: metaobject.id,
      handle: metaobject.handle,
      conditionTitle: fields.condition_title,
      thresholdAmount: fields.threshold_amount,
      currencyCode: fields.currency_code,
      product: getReferenceByKey(metaobject.fields, "required_product"),
      productMinQuantity: fields.product_quantity,
      collection: getReferenceByKey(metaobject.fields, "required_collection"),
      collectionMinQuantity: fields.collection_quantity,
      giftProduct: getReferenceByKey(metaobject.fields, "gift_product"),
    };
  }

  function getFieldsMap(fields) {
    return fields.reduce((acc, field) => {
      acc[field.key] = field.value;
      return acc;
    }, {});
  }

  function getReferenceByKey(fields, key) {
    return fields.find((field) => field.key === key)?.reference || null;
  }

  function isWithinCampaignPeriod(startDatetime, endDatetime) {
    const now = new Date();

    if (startDatetime) {
      const start = new Date(startDatetime);
      if (now < start) return false;
    }

    if (endDatetime) {
      const end = new Date(endDatetime);
      if (now > end) return false;
    }

    return true;
  }

  function isInCart(variantId) {
    return cartLines.some((line) => line.merchandise.id === variantId);
  }

  function getCartLineId(variantId) {
    return cartLines.find((line) => line.merchandise.id === variantId)?.id;
  }

  function getCartQuantity(variantId) {
    const line = cartLines.find((line) => line.merchandise.id === variantId);
    return line?.quantity ?? 0;
  }

  async function increaseQuantity(variantId) {
    if (isGiftVariant(variantId)) {
      console.log("gift quantity is fixed to 1");
      return;
    }

    const lineId = getCartLineId(variantId);
    if (!lineId) return;

    const result = await shopify.applyCartLinesChange({
      type: "updateCartLine",
      id: lineId,
      quantity: getCartQuantity(variantId) + 1,
    });

    console.log("increase result", result);
  }

  async function decreaseQuantity(variantId) {
    const lineId = getCartLineId(variantId);
    if (!lineId) return;

    const current = getCartQuantity(variantId);

    if (isGiftVariant(variantId)) {
      const result = await shopify.applyCartLinesChange({
        type: "removeCartLine",
        id: lineId,
        quantity: current,
      });

      console.log("remove gift result", result);
      return;
    }

    const next = current - 1;

    const result = await shopify.applyCartLinesChange(
      next <= 0
        ? { type: "removeCartLine", id: lineId, quantity: current }
        : { type: "updateCartLine", id: lineId, quantity: next }
    );

    console.log("decrease result", result);
  }

  async function addToCart(variantId) {
    const result = await shopify.applyCartLinesChange({
      type: "addCartLine",
      merchandiseId: variantId,
      quantity: 1,
    });

    console.log("add result", result);
  }

  function handleVariantChange(productId, variantId) {
    setSelectedVariants((prev) => ({
      ...prev,
      [productId]: variantId,
    }));
  }

  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (!canBlockProgress) return { behavior: "allow" };
    if (!eligibleCondition) return { behavior: "allow" };

    const hasGwp = cartLines.some(
      (line) => line?.merchandise?.product?.id === targetProductId
    );

    if (!hasGwp) {
      return {
        behavior: "block",
        reason: "Please select your complimentary anniversary gift before completing checkout.",
      };
    }

    return { behavior: "allow" };
  });

  if (loading) {
    return (
      <s-box
        background="subdued"
        borderRadius="base"
        borderWidth="base"
        padding="base"
      >
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <s-spinner />
          <s-text>Loading gift…</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (!eligibleCondition) return null;
  if (!targetProduct) return null;
  if (targetProductLine) return null;

  console.log("targetProduct", targetProduct);
  const variants = targetProduct.variants.nodes;
  const defaultVariant =
    variants.find((variant) => variant.availableForSale) || variants[0];

  const selectedVariantId =
    selectedVariants[targetProduct.id] || defaultVariant?.id;

  const selectedVariant = variants.find(
    (variant) => variant.id === selectedVariantId
  );

  if (!selectedVariant) return null;

  return (
    <s-box
      background="subdued"
      borderRadius="base"
      borderWidth="base"
      padding="base"
    >
      <s-section>
        <s-stack gap="small-100">
          <s-text size="medium" emphasis="bold">
            Select your free gift
          </s-text>

          <s-text>
            You are eligible for a free gift with this order.
          </s-text>

          <s-grid
            gridTemplateColumns="auto minmax(0, 1fr)"
            gap="base"
            alignItems="center"
          >
            <s-product-thumbnail
              src={selectedVariant?.image?.url || targetProduct.featuredImage?.url}
            />

            <s-grid
              gridTemplateColumns="minmax(0, 1fr) auto"
              gap="small-100"
              alignItems="end"
            >
              <s-box minInlineSize="0">
                <s-select
                  label="Option"
                  value={selectedVariantId}
                  onChange={(event) =>
                    handleVariantChange(targetProduct.id, event.target.value)
                  }
                >
                  {variants.map((variant) => (
                    <s-option key={variant.id} value={variant.id}>
                      {variant.title} - {variant.price.amount}{" "}
                      {variant.price.currencyCode}
                    </s-option>
                  ))}
                </s-select>
              </s-box>

              {isInCart(selectedVariantId) ? (
                <s-box>
                  <s-text>1 item added</s-text>
                </s-box>
              ) : (
                <s-button
                  size="small"
                  disabled={
                    !selectedVariant?.availableForSale ||
                    !instructions?.lines?.canAddCartLine
                  }
                  onClick={() => addToCart(selectedVariantId)}
                >
                  Add
                </s-button>
              )}
            </s-grid>
          </s-grid>
        </s-stack>
      </s-section>
    </s-box>
  );
}