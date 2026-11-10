import {
  Mail,
  Image,
  Webhook,
  Upload,
  Layers,
  ShieldCheck,
  Terminal,
  type LucideIcon
} from "lucide-react"

export const jobIcon = (name: string): LucideIcon => {
  if (name.includes("email") || name.includes("welcome")) {
    return Mail
  }
  if (name.includes("image")) {
    return Image
  }
  if (name.includes("webhook")) {
    return Webhook
  }
  if (name.includes("export")) {
    return Upload
  }
  if (name.includes("catalog")) {
    return Layers
  }
  if (name.includes("payment")) {
    return ShieldCheck
  }
  return Terminal
}

export const jobName = (name: string) =>
  name.split(".").at(-1)?.replaceAll(/[-_]/g, " ") ?? name

export const compactTime = (millis: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(millis)
