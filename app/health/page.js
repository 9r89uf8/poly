import HealthPanel from "./health-panel";

export const metadata = {
  title: "Health | Oracle Terminal",
};

export default function HealthPage() {
  return (
    <section className="panel">
      <p className="stat-label">Health</p>
      <h2 style={{ marginTop: 0 }}>Backend freshness and market readiness</h2>
      <HealthPanel />
    </section>
  );
}
