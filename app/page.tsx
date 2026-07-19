'use client'
import { ReactFlowProvider } from '@xyflow/react'
import TopNav from '@/components/TopNav'
import NodeSidebar from '@/components/sidebar/NodeSidebar'
import FlowCanvas from '@/components/FlowCanvas'
import APIKeysPanel from '@/components/panels/APIKeysPanel'
import LayersPanel from '@/components/panels/LayersPanel'
import OnboardingCard from '@/components/onboarding/OnboardingCard'
import CanvasBridge from '@/components/CanvasBridge'
import Lightbox from '@/components/Lightbox'
import { useWorkflowStore } from '@/lib/store/workflowStore'

export default function Home() {
  const showAPIPanel = useWorkflowStore(s => s.showAPIPanel)

  return (
    <ReactFlowProvider>
      <CanvasBridge />
      <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <NodeSidebar />
          <div className="flex-1 relative">
            <OnboardingCard />
            <FlowCanvas />
            <LayersPanel />
          </div>
        </div>
        {showAPIPanel && <APIKeysPanel />}
        <Lightbox />
      </div>
    </ReactFlowProvider>
  )
}
