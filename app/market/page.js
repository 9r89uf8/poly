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
          Paste an event URL or slug, preview bins, then set the event active for the current Chicago day.
        </p>
      </section>
      <MarketClient />
    </>
  );
}
