'use client'
// Compact mode preset picker — dropdown of 9 UGC / ad modes. When the user
// picks one, the node's prompt textarea gets filled with that mode's
// scaffold (still editable), and the matching aspect ratio + duration
// hints are applied if the chosen model supports them.

import Select from '@/components/ui/Select'
import { VIDEO_MODES, modeBySlug } from '@/lib/api/modes'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { getModelSpec } from '@/lib/api/capabilities'

export default function ModePicker({ id, data }: {
  id: string
  data: Record<string, unknown>
}) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const current = (data.mode as string) || ''

  const apply = (slug: string) => {
    const m = modeBySlug(slug)
    if (!m) return
    const patch: Record<string, unknown> = {
      mode: slug,
      prompt: m.promptTemplate,
    }
    // Only apply aspect / duration hints if the currently-selected model
    // actually accepts those values — otherwise the model would reject
    // the run with a validation error.
    const modelSlug = data.model as string | undefined
    if (modelSlug) {
      const spec = getModelSpec(modelSlug)
      const aspectEnum = spec?.params.aspect_ratio?.enum as string[] | undefined
      const durEnum    = spec?.params.duration?.enum as number[] | undefined
      if (m.preferredAspect && (!aspectEnum || aspectEnum.includes(m.preferredAspect))) {
        patch.aspect_ratio = m.preferredAspect
      }
      if (m.preferredDuration && (!durEnum || durEnum.includes(m.preferredDuration))) {
        patch.duration = m.preferredDuration
      }
    }
    update(id, patch)
  }

  return (
    <Select
      value={current}
      onChange={apply}
      options={[
        { id: '', name: '— pick a mode preset —', description: 'Fills the prompt with a scaffold you can edit' },
        ...VIDEO_MODES.map(m => ({
          id: m.slug,
          name: m.label,
          description: m.description,
        })),
      ]}
    />
  )
}
