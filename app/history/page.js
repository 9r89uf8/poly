import HistoryClient from "./history-client";

export const metadata = {
  title: "History | Oracle Terminal",
};

export default async function HistoryPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  return <HistoryClient initialSearchParams={resolvedSearchParams ?? {}} />;
}

