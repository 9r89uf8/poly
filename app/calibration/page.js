import CalibrationClient from "./calibration-client";

export const metadata = {
  title: "Calibration | Oracle Terminal",
};

export default function CalibrationPage() {
  return (
    <>
      <section className="panel">
        <p className="stat-label">Calibration</p>
        <h2 style={{ marginTop: 0 }}>Truth Engine (WU alignment)</h2>
        <p className="muted">
          Enter final WU highs for a date range, run IEM backtest methods, then
          adopt the best extraction/rounding method.
        </p>
      </section>
      <CalibrationClient />
    </>
  );
}
