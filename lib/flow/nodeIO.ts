// Per-node-type IO map for the data flow engine.
//
// inputs[handleId]  = the `data` field where an INCOMING value should be written
//                     when an edge lands on this handle. Run handlers already
//                     read from these fields (e.g. textToImageNode reads
//                     data.prompt), so the engine just fills them in.
//
// outputs[handleId] = the `data` field that holds this node's OUTGOING value
//                     for that handle. The engine reads it and propagates to
//                     downstream targets.

export interface NodeIOMap {
  inputs?: Record<string, string>
  outputs?: Record<string, string>
}

export const NODE_IO: Record<string, NodeIOMap> = {
  // ── TEXT / PROMPT ──────────────────────────────────────────
  promptNode: {
    outputs: { text: 'prompt' },
  },
  promptEnhancerNode: {
    inputs: { text: 'prompt' },
    outputs: { text: 'enhanced' },
  },
  promptConcatNode: {
    inputs: { textA: 'textA', textB: 'textB' },
    outputs: { text: 'combined' },
  },
  // Director Formula node — structured prompt builder. Encodes the
  // SHOT + LENS + LIGHT + TEXTURE + COMPOSITION + STYLE REF formula
  // (Sergey Kabankov / AI Video Creators, banked in
  // [[prompt-director-formula]]) as a form. No inputs; pure output —
  // the assembled prompt text feeds any downstream prompt slot.
  directorPromptNode: {
    outputs: { text: 'output' },
  },
  llmNode: {
    inputs: { text: 'message', image: 'imageUrl' },
    outputs: { text: 'result' },
  },
  imageDescriberNode: {
    inputs: { image: 'imageUrl' },
    outputs: { text: 'result' },
  },
  // Vision LLM describes 1–5 images as a single strict JSON object that
  // covers everything visible across them. Output text is the JSON string
  // — wire into any text input (prompt enhancer, compositor prompt,
  // ReferenceSheet prompt). Locks identity / location with a text spec
  // the way our manual JSON did for Applegreen.
  imageToJsonNode: {
    inputs: {
      image1: 'image1Url', image2: 'image2Url', image3: 'image3Url',
      image4: 'image4Url', image5: 'image5Url',
      // Extra instructions wired in from upstream (or typed directly)
      // get appended to the system prompt as ADDITIONAL EXTRACTION
      // DIRECTION. Negative instructions get appended as an AVOID
      // block. Both are optional.
      extra: 'extraInstructions',
      negative: 'negative_prompt',
    },
    outputs: { text: 'result' },
  },
  videoDescriberNode: {
    inputs: { video: 'videoUrl' },
    outputs: { text: 'result' },
  },
  audioTranscriberNode: {
    inputs: { audio: 'audioUrl' },
    outputs: { text: 'result' },
  },
  ttsNode: {
    // Accepts a text input on the `text` handle which propagates into
    // `data.text`. The voiceId input lets a Voice Cloner upstream feed
    // an ElevenLabs cloned voice_id straight in. Instructions field
    // is node-local only.
    inputs: { text: 'text', voiceId: 'voiceId' },
    outputs: { audio: 'audioUrl' },
  },

  // ── IMAGE ──────────────────────────────────────────────────
  textToImageNode: {
    inputs: { text: 'prompt', reference: 'referenceUrl', negative: 'negative_prompt' },
    outputs: { image: 'imageUrl' },
  },
  imageToImageNode: {
    inputs: { image: 'imageUrl', text: 'prompt', negative: 'negative_prompt' },
    // Output is data.outputUrl — the run handler writes generated result
    // there; data.imageUrl is the input. Earlier this was wrongly mapped
    // to imageUrl, which made downstream nodes receive the upstream's
    // INPUT image instead of its OUTPUT.
    outputs: { image: 'outputUrl' },
  },
  upscaleNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  bgRemoveNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  relightNode: {
    inputs: { image: 'imageUrl', text: 'prompt' },
    outputs: { image: 'outputUrl' },
  },
  inpaintNode: {
    inputs: { image: 'imageUrl', mask: 'maskUrl', text: 'prompt' },
    outputs: { image: 'outputUrl' },
  },
  outpaintNode: {
    inputs: { image: 'imageUrl', text: 'prompt' },
    outputs: { image: 'outputUrl' },
  },
  faceSwapNode: {
    inputs: { source: 'sourceUrl', target: 'targetUrl' },
    outputs: { image: 'outputUrl' },
  },
  objectRemoveNode: {
    inputs: { image: 'imageUrl', mask: 'maskUrl' },
    outputs: { image: 'outputUrl' },
  },
  outfitChangeNode: {
    inputs: { image: 'imageUrl', text: 'prompt' },
    outputs: { image: 'outputUrl' },
  },
  // Compositor — two image inputs (subject + scene) + a prompt. Routes
  // through MuAPI's multi-reference edit models (Nano Banana Pro Edit,
  // Seedream v4.5 Edit, Qwen Edit) which natively handle composition +
  // light matching when given multiple ref images.
  compositorNode: {
    // Multi-subject compositor. ONE scene + up to FOUR subjects.
    // Common shape: subject = character, subject2 = product, scene =
    // background. Each subject has an optional JSON spec input (text)
    // wired from an Image→JSON / Board's output for tighter identity
    // lock. Subjects beyond #1 are optional; existing wires that use
    // only `subject` + `scene` keep working.
    inputs: {
      subject: 'subjectUrl',
      subject2: 'subject2Url',
      subject3: 'subject3Url',
      subject4: 'subject4Url',
      scene: 'sceneUrl',
      text: 'prompt', negative: 'negative_prompt',
      subjectJson: 'subjectJson',
      subject2Json: 'subject2Json',
      subject3Json: 'subject3Json',
      subject4Json: 'subject4Json',
      sceneJson: 'sceneJson',
    },
    outputs: { image: 'outputUrl' },
  },
  // Reference Sheet — feed up to 6 reference images of the SAME thing
  // (a person, a location, a product) and one prompt. Nano Banana
  // (and similar multi-ref edit models) use all of them as identity /
  // location anchors and produce a clean reference grid that downstream
  // compositors can use. Better than asking a single-image edit model
  // to "imagine 4 angles" of something it's only seen once.
  referenceSheetNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url', ref6: 'ref6Url',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  // Kind-locked Board generators. Each bakes a detailed system prompt
  // describing the canonical Board layout for that subject type
  // (Character / Location / Product / B-roll / Storyboard / Mascot /
  // Creature). Up to 5 reference images of the SAME subject + an
  // optional JSON spec (locks identity tighter) + optional user
  // direction. Output is a single Board image — feed it into Image→JSON
  // downstream to extract a strict JSON spec for compositors.
  characterBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  locationBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  productBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  bRollBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  storyboardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  mascotBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },
  creatureBoardNode: {
    inputs: {
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url',
      subjectJson: 'subjectJson',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { image: 'outputUrl' },
  },

  // ── VIDEO ──────────────────────────────────────────────────
  textToVideoNode: {
    inputs: { text: 'prompt', negative: 'negative_prompt' },
    outputs: { video: 'videoUrl' },
  },
  imageToVideoNode: {
    // firstImage + lastImage cover the traditional I2V case (and the
    // Higgsfield-style transition when both are wired). ref1..ref9 add
    // omni-reference support — Seedance 2 VIP and any future multi-ref
    // I2V model collect populated refs into images_list, addressable
    // from the prompt as @image1..@image9.
    inputs: {
      firstImage: 'imageUrl', lastImage: 'endImageUrl',
      ref1: 'ref1Url', ref2: 'ref2Url', ref3: 'ref3Url',
      ref4: 'ref4Url', ref5: 'ref5Url', ref6: 'ref6Url',
      ref7: 'ref7Url', ref8: 'ref8Url', ref9: 'ref9Url',
      text: 'prompt', negative: 'negative_prompt',
    },
    outputs: { video: 'videoUrl' },
  },
  videoToVideoNode: {
    inputs: { video: 'videoUrl', text: 'prompt' },
    outputs: { video: 'videoUrl' },
  },
  lipSyncNode: {
    inputs: { video: 'videoUrl', audio: 'audioUrl' },
    outputs: { video: 'videoUrl' },
  },
  videoUpscaleNode: {
    inputs: { video: 'videoUrl' },
    outputs: { video: 'videoUrl' },
  },
  speechToVideoNode: {
    inputs: { image: 'imageUrl', audio: 'audioUrl' },
    outputs: { video: 'videoUrl' },
  },

  // ── EDIT ───────────────────────────────────────────────────
  cropNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  blurNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  levelsNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  invertNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl' },
  },
  extractFrameNode: {
    inputs: { video: 'videoUrl' },
    outputs: { image: 'outputUrl' },
  },
  painterNode: {
    inputs: { image: 'imageUrl' },
    outputs: { image: 'outputUrl', mask: 'maskUrl' },
  },

  // ── MASK ───────────────────────────────────────────────────
  maskExtractorNode: {
    inputs: { image: 'imageUrl' },
    outputs: { mask: 'maskUrl' },
  },
  maskByTextNode: {
    inputs: { image: 'imageUrl', text: 'prompt' },
    outputs: { mask: 'maskUrl' },
  },
  matteGrowShrinkNode: {
    inputs: { mask: 'maskUrl' },
    outputs: { mask: 'maskUrl' },
  },
  mergeAlphaNode: {
    inputs: { image: 'imageUrl', mask: 'maskUrl' },
    outputs: { image: 'outputUrl' },
  },
  videoMatteNode: {
    inputs: { video: 'videoUrl' },
    outputs: { mask: 'maskUrl' },
  },

  // ── INTEGRATIONS ───────────────────────────────────────────
  figmaImportNode: {
    outputs: { image: 'imageUrl' },
  },
  // URL Import — fetched page text out the text handle, og:image out the
  // image handle.
  urlImportNode: {
    outputs: { text: 'result', logo: 'logoDetected', image: 'imageUrl' },
  },
  // Carousel Board — source text + optional logo/reference in; one output
  // handle per rendered slide (the node shows handles up to its count
  // slider; declaring the max here is harmless — propagation only reads
  // wired edges).
  carouselBoardNode: {
    inputs: { text: 'sourceText', logo: 'logoUrl', ref: 'refImageUrl' },
    outputs: {
      slide1: 'slide1Url', slide2: 'slide2Url', slide3: 'slide3Url',
      slide4: 'slide4Url', slide5: 'slide5Url', slide6: 'slide6Url',
      slide7: 'slide7Url', slide8: 'slide8Url', slide9: 'slide9Url',
      slide10: 'slide10Url',
    },
  },

  // ── UPLOADS (sources) ──────────────────────────────────────
  imageUploadNode: {
    outputs: { image: 'imageUrl' },
  },
  videoUploadNode: {
    outputs: { video: 'videoUrl' },
  },
  audioUploadNode: {
    outputs: { audio: 'audioUrl' },
  },
  // Voice cloner — takes 1+ audio samples (data: URLs or hosted),
  // creates an ElevenLabs instant voice clone, outputs the voice_id
  // for downstream TTS calls. The voice_id persists in node data so
  // cloning is a one-time cost per voice.
  voiceClonerNode: {
    inputs: { audio: 'audioUrl' },
    outputs: { voiceId: 'voiceId' },
  },

  // ── HELPERS ────────────────────────────────────────────────
  compareNode: {
    inputs: { before: 'beforeUrl', after: 'afterUrl' },
  },

  // ── 3D ─────────────────────────────────────────────────────
  imageTo3DNode: {
    inputs: { image: 'imageUrl', text: 'prompt' },
    outputs: { image: 'outputUrl', mesh: 'glbUrl' },
  },

  // ── OUTPUT ─────────────────────────────────────────────────
  outputNode: {
    inputs: { image: 'imageUrl', video: 'videoUrl', audio: 'audioUrl', mesh: 'meshUrl' },
  },
}
