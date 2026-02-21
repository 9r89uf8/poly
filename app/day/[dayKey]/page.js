import DayDetailClient from "./day-detail-client";

export const metadata = {
  title: "Day Detail | Oracle Terminal",
};

export default async function DayDetailPage({ params }) {
  const resolvedParams = await params;
  const dayKey = decodeURIComponent(resolvedParams?.dayKey ?? "");

  return <DayDetailClient dayKey={dayKey} />;
}
