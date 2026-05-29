import { json } from "@remix-run/node";
import prisma from "../db.server";

export async function loader({ request }) {
  try {
    const offers = await prisma.offer.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    const sessions = await prisma.session.findMany({
      take: 10
    });
    const now = new Date();
    return new Response(JSON.stringify({
      now: now.toISOString(),
      sessions: sessions.map(s => ({ id: s.id, shop: s.shop })),
      offers: offers.map(o => ({
        id: o.id,
        title: o.title,
        status: o.status,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        shop: o.shop,
        offerType: o.offerType,
        configType: o.config?.configType || o.config?.subtype,
        startsAt_lte_now: new Date(o.startsAt) <= now,
        endsAt_gte_now: o.endsAt ? new Date(o.endsAt) >= now : true
      }))
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
}
