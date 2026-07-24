export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-gray-900 text-white px-8 py-5 shadow">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">🚀 CreatorOS</h1>
          <span className="text-gray-300">Welcome, Shashank</span>
        </div>
      </header>

      {/* Dashboard */}
      <section className="max-w-7xl mx-auto p-8">

        <h2 className="text-2xl font-bold mb-6">
          Dashboard
        </h2>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-gray-500">Channels</h3>
            <p className="text-4xl font-bold mt-2">0</p>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-gray-500">Videos Scheduled</h3>
            <p className="text-4xl font-bold mt-2">0</p>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-gray-500">AI Agents</h3>
            <p className="text-4xl font-bold mt-2">0</p>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-gray-500">Estimated Revenue</h3>
            <p className="text-4xl font-bold mt-2">$0</p>
          </div>

        </div>

        {/* Channels */}
        <div className="bg-white rounded-xl shadow p-6">

          <div className="flex justify-between items-center mb-6">

            <h2 className="text-2xl font-bold">
              Your Channels
            </h2>

            <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg">
              + Create Channel
            </button>

          </div>

          <div className="text-gray-500">
            No channels yet.
          </div>

        </div>

      </section>
    </main>
  );
}
