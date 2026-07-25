import DashboardLayout from "@/components/layout/DashboardLayout";
import StatCard from "@/components/dashboard/StatCard";

export default function Dashboard() {
  return (
    <DashboardLayout>
      <h1 className="text-4xl font-bold mb-8">
        Dashboard
      </h1>

      <div className="grid grid-cols-4 gap-6">
        <StatCard
          title="Channels"
          value={0}
        />

        <StatCard
          title="Videos"
          value={0}
        />

        <StatCard
          title="AI Agents"
          value={0}
        />

        <StatCard
          title="Revenue"
          value="$0"
        />
      </div>
    </DashboardLayout>
  );
}