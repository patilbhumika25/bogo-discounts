import { Page, Layout, TextContainer, Card, Button, Banner } from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';

export const loader = async ({request}) =>{
    const { billing } = await authenticate.admin(request);
    const { appSubscriptions } = await billing.check();

    return json({
        subscription: appSubscriptions?.[0]
    })
}

export default function BillingPage() {
    const { subscription } = useLoaderData();

    console.log('subs', subscription);


  return (
    <Page title="Billing">
      <Layout>
        <Layout.Section>
            {(subscription || subscription !== undefined ) ? (
            <Banner 
            title={ `You are subscribed to the ${subscription.name} plan`} 
            tone='success' 
            action={{ content: 'Change Plan', url: "https://admin.shopify.com/charges/generate-invoices-1/pricing_plans", target: '_top'  }} 
            ></Banner>) : (
            
          <Card>
            <TextContainer spacing="loose">
              <p>
                To learn about plans and explore other available subscription options,
                click the button below.
              </p>
              <Button target="_top" url="https://admin.shopify.com/charges/generate-invoices-1/pricing_plans" >View Plan Details</Button>
            </TextContainer>
          </Card>)}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
