import { JobsSection } from '../features/jobs/JobsSection.tsx';
import { NodeStatusSection } from '../features/nodes/NodeStatusSection.tsx';
import { StatsDashboard } from '../features/stats/StatsDashboard.tsx';
import { Navbar } from '../components/Navbar.tsx';

function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <Navbar
        actions={
          <div className="flex items-center gap-5 text-sm">
            <a href="#resource-utilization" className="transition hover:opacity-80">
              Resources
            </a>
            <a href="#node-status" className="transition hover:opacity-80">
              Nodes
            </a>
            <a href="#job-queue" className="transition hover:opacity-80">
              Queue
            </a>
          </div>
        }
      />
      <main className="mx-auto max-w-[1800px] px-5 py-5">
        <StatsDashboard />
        <NodeStatusSection />
        <JobsSection />
      </main>
    </div>
  );
}

export { DashboardPage };
