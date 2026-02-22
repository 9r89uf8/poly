import MarketClient from "./market-client";

export const metadata = {
  title: "Market | Oracle Terminal",
};

export default function MarketPage() {
  return (
    <>
      <section className="panel">
        <p className="stat-label">Market Picker</p>
        <h2 style={{ marginTop: 0 }}>Import and activate today’s Polymarket event</h2>
        <p className="muted">
          URL is auto-derived from today’s Chicago date. Use one-click auto import, or override with a custom URL/slug.
        </p>
      </section>
      <MarketClient />
    </>
  );
}
