import SettingsForm from "./settings-form";

export const metadata = {
  title: "Settings | Oracle Terminal",
};

export default function SettingsPage() {
  return (
    <section className="panel">
      <p className="stat-label">Settings</p>
      <h2 style={{ marginTop: 0 }}>Oracle and polling configuration</h2>
      <p className="muted">
        Station and timezone stay locked to KORD and America/Chicago.
      </p>
      <SettingsForm />
    </section>
  );
}
