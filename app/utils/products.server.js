
/**
 * Fetches all product IDs from a list of Collection IDs.
 * Handles pagination to get all products.
 * 
 * @param {Object} admin - The Shopify Admin API client
 * @param {string[]} collectionIds - Array of Collection IDs (GIDs)
 * @returns {Promise<string[]>} - Array of unique Product IDs
 */
export async function getProductsFromCollections(admin, collectionIds) {
    if (!collectionIds || collectionIds.length === 0) return [];

    const productIds = new Set();

    for (const collectionId of collectionIds) {
        let hasNextPage = true;
        let cursor = null;

        while (hasNextPage) {
            const query = `#graphql
        query ($id: ID!, $cursor: String) {
          collection(id: $id) {
            products(first: 250, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      `;

            const response = await admin.graphql(query, {
                variables: { id: collectionId, cursor },
            });
            const data = await response.json();

            const products = data.data?.collection?.products;
            if (!products) break;

            products.edges.forEach((edge) => productIds.add(edge.node.id));

            hasNextPage = products.pageInfo.hasNextPage;
            cursor = products.pageInfo.endCursor;
        }
    }

    return Array.from(productIds);
}
