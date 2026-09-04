import { OFFSCREEN_TARGET, type OffscreenRequest, type OffscreenResponse } from '@/protocol'

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html'
let creatingOffscreen: Promise<void> | null = null

export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  })
  return contexts.length > 0
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Process captured tab audio and measure loudness',
    })
    .finally(() => {
      creatingOffscreen = null
    })
  await creatingOffscreen
}

export async function sendToOffscreen(message: OffscreenRequest): Promise<OffscreenResponse> {
  return (await chrome.runtime.sendMessage(message)) as OffscreenResponse
}

export async function sendToExistingOffscreen(
  message: OffscreenRequest,
): Promise<OffscreenResponse | undefined> {
  if (!(await hasOffscreenDocument())) return undefined
  return sendToOffscreen(message)
}

export async function closeOffscreenIfIdle(tabCount: number): Promise<void> {
  if (tabCount !== 0 || !(await hasOffscreenDocument())) return
  try {
    await chrome.offscreen.closeDocument()
  } catch {
    // Another lifecycle event may already have closed it.
  }
}

export function isOffscreenTarget(message: object): boolean {
  return 'target' in message && message.target === OFFSCREEN_TARGET
}
