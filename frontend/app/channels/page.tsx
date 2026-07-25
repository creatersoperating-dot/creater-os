import DashboardLayout from "@/components/layout/DashboardLayout";
import { getChannels } from "@/services/channelService";
import ChannelCard from "@/components/dashboard/ChannelCard";

export default function ChannelsPage() {
  const channels = getChannels();

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Your Channels</h1>

        <button className="bg-blue-600 text-white px-5 py-3 rounded-xl">
          + Create Channel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
          />
        ))}
      </div>
    </DashboardLayout>
  );
}