import * as collapsible from "@zag-js/collapsible"
import { normalizeProps, useMachine } from "@zag-js/react"
import { cloneElement, isValidElement, useId } from "react"
import { RenderStrategyProps, useRenderStrategy } from "./use-render"

interface Props extends Omit<collapsible.Props, "id" | "open.controlled">, RenderStrategyProps {
  trigger?: React.ReactNode
  children: React.ReactNode
}

export function Collapsible(props: Props) {
  const [machineProps, restProps] = collapsible.splitProps(props)
  const { trigger, children, lazyMount, unmountOnExit } = restProps

  const service = useMachine(collapsible.machine, {
    id: useId(),
    ...machineProps,
  })

  const api = collapsible.connect(service, normalizeProps)

  const { unmount } = useRenderStrategy({
    visible: api.visible,
    lazyMount,
    unmountOnExit,
  })

  return (
    <div {...api.getRootProps()}>
      {isValidElement(trigger) ? cloneElement(trigger, api.getTriggerProps()) : null}
      {unmount ? null : <div {...api.getContentProps()}>{children}</div>}
    </div>
  )
}
