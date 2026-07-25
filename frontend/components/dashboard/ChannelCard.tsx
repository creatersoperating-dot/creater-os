import { Channel } from "@/types/channel";

interface ChannelCardProps {
  channel: Channel;
}

export default function ChannelCard({ channel }: ChannelCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition">
      <h2 className="text-xl font-bold">{channel.name}</h2>

      <p className="text-gray-500 mt-2">
        {channel.description}
      </p>

      <div className="mt-4 space-y-2 text-sm">
        <p>
          <span className="font-semibold">Platform:</span> {channel.platform}
        </p>

        <p>
          <span className="font-semibold">Niche:</span> {channel.niche}
        </p>

        <p>
          <span className="font-semibold">Language:</span> {channel.language}
        </p>
      </div>

      <div className="mt-6 flex gap-3">
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          Open
        </button>

        <button className="border px-4 py-2 rounded-lg hover:bg-gray-100">
          Analytics
        </button>
      </div>
    </div>
  );
}