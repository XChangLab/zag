import { setup } from "@zag-js/core"
import { contains, proxyTabFocus, raf } from "@zag-js/dom-query"
import { trackInteractOutside } from "@zag-js/interact-outside"
import type { Rect, Size } from "@zag-js/types"
import { addDomEvent } from "@zag-js/dom-query"
import { callAll, ensureProps, setRafTimeout } from "@zag-js/utils"
import * as dom from "./navigation-menu.dom"
import type { NavigationMenuSchema, NavigationMenuService } from "./navigation-menu.types"

const { createMachine, guards } = setup<NavigationMenuSchema>()

const { and } = guards

export const machine = createMachine({
  props({ props }) {
    ensureProps(props, ["id"])
    return {
      dir: "ltr",
      openDelay: 200,
      closeDelay: 300,
      orientation: "horizontal",
      defaultValue: null,
      ...props,
    }
  },

  context({ prop, bindable }) {
    return {
      // value tracking
      value: bindable<string | null>(() => ({
        defaultValue: prop("defaultValue"),
        value: prop("value"),
        sync: true,
        onChange(value) {
          prop("onValueChange")?.({ value })
        },
      })),
      previousValue: bindable<string | null>(() => ({
        defaultValue: null,
        sync: true,
      })),

      // interations
      hasPointerMoveOpened: bindable<string | null>(() => ({
        defaultValue: null,
      })),
      wasClickClose: bindable<string | null>(() => ({
        defaultValue: null,
      })),
      wasEscapeClose: bindable<boolean>(() => ({
        defaultValue: false,
      })),

      // viewport
      viewportSize: bindable<Size | null>(() => ({
        defaultValue: null,
        sync: true,
      })),
      isViewportRendered: bindable<boolean>(() => ({
        defaultValue: false,
      })),

      // nodes
      contentNode: bindable<HTMLElement | null>(() => ({
        defaultValue: null,
      })),
      triggerRect: bindable<Rect | null>(() => ({
        defaultValue: null,
        sync: true,
      })),
      triggerNode: bindable<HTMLElement | null>(() => ({
        defaultValue: null,
      })),

      // nesting
      parent: bindable<NavigationMenuService | null>(() => ({
        defaultValue: null,
      })),
      children: bindable<Record<string, NavigationMenuService | null>>(() => ({
        defaultValue: {},
      })),
    }
  },

  computed: {
    isRootMenu: ({ context }) => context.get("parent") == null,
    isSubmenu: ({ context }) => context.get("parent") != null,
  },

  watch({ track, action, context }) {
    track([() => context.get("value")], () => {
      action(["restoreTabOrder", "setTriggerNode", "setContentNode", "syncMotionAttribute"])
    })
  },

  entry: ["checkViewportNode"],

  exit: ["cleanupObservers"],

  initialState() {
    return "closed"
  },

  on: {
    "PARENT.SET": {
      target: "open",
      actions: ["setParentMenu", "setTriggerNode"],
    },
    "CHILD.SET": {
      actions: ["setChildMenu"],
    },
    "TRIGGER.CLICK": [
      {
        target: "closed",
        guard: and("isItemOpen", "isRootMenu"),
        actions: ["clearValue", "setClickCloseRef"],
      },
      {
        reenter: true,
        target: "open",
        actions: ["setValue"],
      },
    ],
    "TRIGGER.POINTERDOWN": {
      actions: ["clearPreviousValue"],
    },
    "TRIGGER.FOCUS": {
      actions: ["focusTopLevelEl"],
    },
    "VALUE.SET": {
      actions: ["setValue"],
    },
  },

  states: {
    closed: {
      entry: ["cleanupObservers", "propagateClose"],
      on: {
        "TRIGGER.ENTER": {
          actions: ["clearCloseRefs", "clearPreviousValue"],
        },
        "TRIGGER.MOVE": [
          {
            guard: "isSubmenu",
            target: "open",
            actions: ["setValue"],
          },
          {
            target: "opening",
            actions: ["setPointerMoveRef"],
          },
        ],
        "TRIGGER.LEAVE": {
          actions: ["clearPointerMoveRef"],
        },
      },
    },

    opening: {
      effects: ["waitForOpenDelay"],
      on: {
        "OPEN.DELAY": {
          target: "open",
          actions: ["setValue"],
        },
        "TRIGGER.LEAVE": {
          target: "closed",
          actions: ["clearValue", "clearPointerMoveRef"],
        },
        "CONTENT.FOCUS": {
          actions: ["focusContent", "restoreTabOrder"],
        },
        "LINK.FOCUS": {
          actions: ["focusLink"],
        },
      },
    },

    open: {
      tags: ["open"],
      effects: ["trackEscapeKey", "trackInteractionOutside", "preserveTabOrder"],
      on: {
        "CONTENT.LEAVE": {
          target: "closing",
        },
        "TRIGGER.LEAVE": {
          target: "closing",
          actions: ["clearPointerMoveRef"],
        },
        "CONTENT.FOCUS": {
          actions: ["focusContent", "restoreTabOrder"],
        },
        "LINK.FOCUS": {
          actions: ["focusLink"],
        },
        "CONTENT.DISMISS": {
          target: "closed",
          actions: ["focusTriggerIfNeeded", "clearValue", "clearPointerMoveRef"],
        },
        "CONTENT.ENTER": {
          actions: ["restoreTabOrder"],
        },
        "TRIGGER.MOVE": {
          guard: "isSubmenu",
          actions: ["setValue"],
        },
        "ROOT.CLOSE": {
          // clear the previous value so indicator doesn't animate
          actions: ["clearPreviousValue", "cleanupObservers"],
        },
      },
    },

    closing: {
      tags: ["open"],
      effects: ["trackInteractionOutside", "waitForCloseDelay"],
      on: {
        "CLOSE.DELAY": {
          target: "closed",
          actions: ["clearValue", "clearPreviousValue"],
        },
        "CONTENT.DISMISS": {
          target: "closed",
          actions: ["focusTriggerIfNeeded", "clearValue", "clearPointerMoveRef"],
        },
        "CONTENT.ENTER": {
          target: "open",
          actions: ["restoreTabOrder"],
        },
        "TRIGGER.ENTER": {
          actions: ["clearCloseRefs"],
        },
        "TRIGGER.MOVE": [
          {
            guard: "isOpen",
            target: "open",
            actions: ["setValue", "setPointerMoveRef"],
          },
          {
            target: "opening",
            actions: ["setPointerMoveRef"],
          },
        ],
      },
    },
  },

  implementations: {
    guards: {
      isOpen: ({ context }) => context.get("value") !== null,
      isItemOpen: ({ context, event }) => context.get("value") === event.value,
      isRootMenu: ({ context }) => context.get("parent") == null,
      isSubmenu: ({ context }) => context.get("parent") != null,
    },

    effects: {
      waitForOpenDelay: ({ send, prop, event }) => {
        return setRafTimeout(() => {
          send({ type: "OPEN.DELAY", value: event.value })
        }, prop("openDelay"))
      },
      waitForCloseDelay: ({ send, prop, event }) => {
        return setRafTimeout(() => {
          send({ type: "CLOSE.DELAY", value: event.value })
        }, prop("closeDelay"))
      },
      preserveTabOrder({ context, scope, refs }) {
        if (!context.get("isViewportRendered")) return
        if (context.get("value") == null) return
        const contentEl = () => dom.getContentEl(scope, context.get("value")!)
        return proxyTabFocus(contentEl, {
          triggerElement: dom.getTriggerEl(scope, context.get("value")!),
          onFocusEnter() {
            refs.get("tabOrderCleanup")?.()
          },
        })
      },
      trackInteractionOutside({ context, computed, refs, send, scope }) {
        if (context.get("value") == null) return
        if (computed("isSubmenu")) return

        const getContentEl = () =>
          context.get("isViewportRendered") ? dom.getViewportEl(scope) : dom.getContentEl(scope, context.get("value")!)

        return trackInteractOutside(getContentEl, {
          defer: true,
          onFocusOutside(event) {
            // remove tabbable elements from tab order
            refs.get("tabOrderCleanup")?.()
            refs.set("tabOrderCleanup", removeFromTabOrder(dom.getTabbableEls(scope, context.get("value")!)))

            const { target } = event.detail.originalEvent
            const rootEl = dom.getRootMenuEl(scope)
            if (contains(rootEl, target)) event.preventDefault()
          },
          onPointerDownOutside(event) {
            const { target } = event.detail.originalEvent

            const topLevelEls = dom.getTopLevelEls(scope)
            const isTrigger = topLevelEls.some((item) => contains(item, target))

            const viewportEl = dom.getViewportEl(scope)
            const isRootViewport = computed("isRootMenu") && contains(viewportEl, target)
            if (isTrigger || isRootViewport) event.preventDefault()
          },
          onInteractOutside(event) {
            if (event.defaultPrevented) return
            send({ type: "CONTENT.DISMISS", src: "interact-outside" })
          },
        })
      },

      trackEscapeKey({ computed, context, send, scope }) {
        if (computed("isSubmenu")) return
        const onKeyDown = (evt: KeyboardEvent) => {
          if (evt.isComposing) return
          if (evt.key !== "Escape") return
          context.set("wasEscapeClose", true)
          send({ type: "CONTENT.DISMISS", src: "key.esc" })
        }
        return addDomEvent(scope.getDoc(), "keydown", onKeyDown)
      },
    },

    actions: {
      clearCloseRefs({ context }) {
        context.set("wasClickClose", null)
        context.set("wasEscapeClose", false)
      },
      setPointerMoveRef({ context, event }) {
        context.set("hasPointerMoveOpened", event.value)
      },
      clearPointerMoveRef({ context }) {
        context.set("hasPointerMoveOpened", null)
      },
      cleanupObservers({ refs }) {
        refs.get("contentCleanup")?.()
        refs.get("triggerCleanup")?.()
        refs.get("tabOrderCleanup")?.()
      },

      setContentNode({ context, scope, refs }) {
        const value = context.get("value")
        const node = value != null ? dom.getContentEl(scope, value) : null

        // set node
        if (!node) return
        context.set("contentNode", node)

        if (!context.get("isViewportRendered")) return

        // cleanup
        refs.get("contentCleanup")?.()
        const exec = () => {
          const size = { width: node.offsetWidth, height: node.offsetHeight }
          context.set("viewportSize", size)
        }
        refs.set("contentCleanup", dom.trackResizeObserver(node, exec))
      },

      setTriggerNode({ context, scope, refs }) {
        const value = context.get("value")
        const node = value != null ? dom.getTriggerEl(scope, value) : null

        // set node
        if (!node) return
        context.set("triggerNode", node)

        // cleanup
        refs.get("triggerCleanup")?.()
        const exec = () => {
          const rect = { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight }
          context.set("triggerRect", rect)
        }

        const indicatorTrackEl = dom.getIndicatorTrackEl(scope)
        refs.set(
          "triggerCleanup",
          callAll(dom.trackResizeObserver(node, exec), dom.trackResizeObserver(indicatorTrackEl, exec)),
        )
      },
      syncMotionAttribute({ context, scope, computed }) {
        if (!context.get("isViewportRendered")) return
        if (computed("isSubmenu")) return
        dom.setMotionAttr(scope, context.get("value"), context.get("previousValue"))
      },
      setClickCloseRef({ event, context }) {
        context.set("wasClickClose", event.value)
      },
      checkViewportNode({ context, scope }) {
        context.set("isViewportRendered", !!dom.getViewportEl(scope))
      },
      clearPreviousValue({ context }) {
        context.set("previousValue", null)
      },
      clearValue({ context }) {
        context.set("previousValue", null)
        context.set("value", null)
      },
      setValue({ context, event }) {
        context.set("previousValue", context.get("value"))
        context.set("value", event.value)
      },
      focusTopLevelEl({ event, scope }) {
        const value = event.value
        if (event.target === "next") dom.getNextTopLevelEl(scope, value)?.focus()
        else if (event.target === "prev") dom.getPrevTopLevelEl(scope, value)?.focus()
        else if (event.target === "first") dom.getFirstTopLevelEl(scope)?.focus()
        else if (event.target === "last") dom.getLastTopLevelEl(scope)?.focus()
        else dom.getTriggerEl(scope, value)?.focus()
      },
      focusLink({ event, scope }) {
        const value = event.value
        if (event.target === "next") dom.getNextLinkEl(scope, value, event.node)?.focus()
        else if (event.target === "prev") dom.getPrevLinkEl(scope, value, event.node)?.focus()
        else if (event.target === "first") dom.getFirstLinkEl(scope, value)?.focus()
        else if (event.target === "last") dom.getLastLinkEl(scope, value)?.focus()
      },
      focusContent({ event, scope }) {
        raf(() => {
          const tabbableEls = dom.getTabbableEls(scope, event.value)
          tabbableEls[0]?.focus()
        })
      },
      focusTriggerIfNeeded({ context, scope }) {
        if (context.get("value") == null) return
        const contentEl = dom.getContentEl(scope, context.get("value")!)
        if (!contains(contentEl, scope.getActiveElement())) return
        context.get("triggerNode")?.focus()
      },
      restoreTabOrder({ refs }) {
        refs.get("tabOrderCleanup")?.()
      },
      setParentMenu({ context, event }) {
        context.set("parent", event.parent)
      },
      setChildMenu({ context, event }) {
        context.set("children", (prev) => ({ ...prev, [event.id]: event.value }))
      },
      propagateClose({ context, prop }) {
        const menus = Object.values(context.get("children"))
        menus.forEach((child) => {
          child?.send({ type: "ROOT.CLOSE", src: prop("id")! })
        })
      },
    },
  },
})

function removeFromTabOrder(nodes: HTMLElement[]) {
  nodes.forEach((node) => {
    node.dataset.tabindex = node.getAttribute("tabindex") || ""
    node.setAttribute("tabindex", "-1")
  })
  return () => {
    nodes.forEach((node) => {
      if (node.dataset.tabindex == null) return
      const prevTabIndex = node.dataset.tabindex
      node.setAttribute("tabindex", prevTabIndex)
      delete node.dataset.tabindex
      if (node.getAttribute("tabindex") === "") node.removeAttribute("tabindex")
    })
  }
}
