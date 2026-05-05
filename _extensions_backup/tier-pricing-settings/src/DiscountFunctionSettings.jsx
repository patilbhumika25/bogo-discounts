import {
  reactExtension,
  AdminBlock,
  BlockStack,
  TextField,
} from "@shopify/ui-extensions-react/admin";

export default reactExtension(
  "admin.discount-details.function-settings.render",
  () => <App />
);

function App() {
  return (
    <AdminBlock title="Tier Bundle Pricing">
      <BlockStack>
        <TextField label="Price for 2 products" name="price2" />
        <TextField label="Price for 3 products" name="price3" />
        <TextField label="Price for 4 products" name="price4" />
      </BlockStack>
    </AdminBlock>
  );
}