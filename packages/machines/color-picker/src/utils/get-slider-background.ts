import type { ChannelProps, MachineContext } from "../color-picker.types"

function getSliderBackgroundDirection(orientation: "vertical" | "horizontal", dir: "ltr" | "rtl") {
  if (orientation === "vertical") {
    return "top"
  } else if (dir === "ltr") {
    return "right"
  } else {
    return "left"
  }
}

export const getSliderBackground = (ctx: MachineContext, props: Required<ChannelProps>) => {
  const { channel } = props

  const dir = getSliderBackgroundDirection(props.orientation, ctx.dir!)
  const value = ctx.value

  const { minValue, maxValue } = value.getChannelRange(channel)

  switch (channel) {
    case "hue":
      return `linear-gradient(to ${dir}, rgb(255, 0, 0) 0%, rgb(255, 255, 0) 17%, rgb(0, 255, 0) 33%, rgb(0, 255, 255) 50%, rgb(0, 0, 255) 67%, rgb(255, 0, 255) 83%, rgb(255, 0, 0) 100%)`
    case "lightness": {
      let start = value.withChannelValue(channel, minValue).toString("css")
      let middle = value.withChannelValue(channel, (maxValue - minValue) / 2).toString("css")
      let end = value.withChannelValue(channel, maxValue).toString("css")
      return `linear-gradient(to ${dir}, ${start}, ${middle}, ${end})`
    }
    case "saturation":
    case "brightness":
    case "red":
    case "green":
    case "blue":
    case "alpha": {
      let start = value.withChannelValue(channel, minValue).toString("css")
      let end = value.withChannelValue(channel, maxValue).toString("css")
      return `linear-gradient(to ${dir}, ${start}, ${end})`
    }
    default:
      throw new Error("Unknown color channel: " + channel)
  }
}
