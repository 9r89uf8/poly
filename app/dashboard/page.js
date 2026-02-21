import DashboardOverview from "../dashboard-overview";

export const metadata = {
  title: "Dashboard | Oracle Terminal",
};

export default function DashboardPage() {
  return (
    <>
      <DashboardOverview />
      <section className="panel">
        <p className="stat-label">Trading Checklist</p>
        <p className="muted">
          Manual runbook checklist UI is still pending in the next plan item.
        </p>
      </section>
    </>
  );
}
