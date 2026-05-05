import { json, redirect } from "@remix-run/node";
import { useNavigate, useActionData, Form } from "@remix-run/react";

import {
  Page,
  Card,
  TextField,
  Layout,
  FormLayout,
  Button,
  Banner,
} from "@shopify/polaris";

import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { requireSubscription } from "../utils/requireSubscription";
import prisma from "../db.server";
import { sendOwnerEmail } from "../utils/sendMail.server";

// ---------------- LOADER ----------------
export const loader = async ({ request }) => {
  const { shouldRedirect } = await requireSubscription(request);

  if (shouldRedirect) {
    return redirect("/app/billing");
  }

  return json({ ok: true });
};

// ---------------- ACTION ----------------
export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const title = String(formData.get("title") || "");
    const emailAddress = String(formData.get("emailAddress") || "");
    const notes = String(formData.get("notes") || "");

    if (!title || !emailAddress) {
      return json(
        { error: "Title and email address are required" },
        { status: 400 }
      );
    }

    // 1️⃣ SAVE OFFER IN DB (dynamic JSON)
    const offer = await prisma.offer.create({
      data: {
        title,
        triggerType: "custom",
        triggerIds: [],
        minQty: 0,

        rewardType: "custom",
        rewardApplyTo: "custom",
        rewardIds: [],
        rewardQty: 1,

        shop: session.shop,
        status: "DRAFT",
        functionId: "custom-offer",
        startsAt: new Date(),

        config: {
          emailAddress,
          notes,
        },
      },
    });

    // 2️⃣ SEND EMAIL TO STORE OWNER
    await sendOwnerEmail({
      shop: session.shop,
      title,
      userEmail: emailAddress,
      notes,
    });

    return json({ success: true, offerId: offer.id });
  } catch (error) {
    console.error("Error creating custom offer:", error);
    return json(
      { error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

// ---------------- COMPONENT ----------------
export default function CustomOfferPage() {
  const navigate = useNavigate();
  const actionData = useActionData();

  const [title, setTitle] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (actionData?.success) {
      navigate("/app/campaign");
    }
  }, [actionData, navigate]);

  return (
    <Page title="Create Custom Offer">
      <Layout>
        <Layout.Section>
          <Card>
            {actionData?.error && (
              <Banner title="Error" tone="critical">
                {actionData.error}
              </Banner>
            )}

            <Form method="post">
              <FormLayout>
                <TextField
                  label="Offer Title"
                  value={title}
                  onChange={setTitle}
                  name="title"
                  placeholder="e.g., Bulk Order Discount"
                  requiredIndicator
                />

                <TextField
                  label="Email Address"
                  value={emailAddress}
                  onChange={setEmailAddress}
                  name="emailAddress"
                  type="email"
                  placeholder="contact@example.com"
                  requiredIndicator
                />

                <TextField
                  label="Additional Notes"
                  value={notes}
                  onChange={setNotes}
                  name="notes"
                  placeholder="Add any additional details"
                  multiline={4}
                />

                <FormLayout.Group condensed>
                  <Button submit variant="primary">
                    Create Custom Offer
                  </Button>
                  <Button onClick={() => navigate("/app/campaign")}>
                    Cancel
                  </Button>
                </FormLayout.Group>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
