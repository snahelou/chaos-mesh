import {
  CallchainFrame,
  Experiment,
  ExperimentScope,
  ExperimentTarget,
  FormikCtx,
} from 'components/NewExperiment/types'

import { defaultExperimentSchema } from 'components/NewExperiment/constants'
import snakeCaseKeys from 'snakecase-keys'

export const ChaosKindKeyMap: {
  [kind: string]: { [key: string]: Exclude<keyof ExperimentTarget, 'kind'> }
} = {
  PodChaos: { key: 'pod_chaos' },
  NetworkChaos: { key: 'network_chaos' },
  IoChaos: { key: 'io_chaos' },
  KernelChaos: { key: 'kernel_chaos' },
  TimeChaos: { key: 'time_chaos' },
  StressChaos: { key: 'stress_chaos' },
}

export function parseSubmit(e: Experiment) {
  const values: Experiment = JSON.parse(JSON.stringify(e))

  // Parse phase_selectors
  const phaseSelectors = values.scope.phase_selectors
  if (phaseSelectors.length === 1 && phaseSelectors[0] === 'all') {
    values.scope.phase_selectors = []
  }

  // Parse labels, label_selectors, annotations and annotation_selectors to object
  function helper1(selectors: string[]) {
    return selectors.reduce((acc: { [key: string]: string }, d) => {
      const splited = d.replace(/\s/g, '').split(':')

      acc[splited[0]] = splited[1]

      return acc
    }, {})
  }
  function helper2(scope: ExperimentScope) {
    scope.label_selectors = helper1(scope.label_selectors as string[])
    scope.annotation_selectors = helper1(scope.annotation_selectors as string[])
  }
  values.labels = helper1(values.labels as string[])
  values.annotations = helper1(values.annotations as string[])
  helper2(values.scope)
  // Handle NetworkChaos target
  const networkTarget = values.target.network_chaos.target
  if (networkTarget) {
    if (networkTarget.mode) {
      helper2(values.target.network_chaos.target!)
    } else {
      values.target.network_chaos.target = undefined
    }
  }

  // Remove unrelated chaos
  const kind = values.target.kind
  Object.entries(ChaosKindKeyMap)
    .filter((k) => k[0] !== kind)
    .map((k) => k[1].key)
    .forEach((k) => delete values.target[k])

  // Remove unrelated actions
  if (['PodChaos', 'NetworkChaos'].includes(kind)) {
    for (const key in values.target) {
      if (key !== 'kind') {
        const chaos = (values.target as any)[key]

        for (const action in chaos) {
          if (
            action === 'action' ||
            // Handle PodChaos container-kill action
            (chaos.action === 'container-kill' && action === 'container_name') ||
            // Pass NetworkChaos target
            action === 'target' ||
            // Handle NetworkChaos partition action
            (chaos.action === 'partition' && action === 'direction')
          ) {
            continue
          }

          if (action !== chaos.action) {
            delete chaos[action]
          }
        }
      }
    }
  }

  return values
}

export function mustSchedule(formikValues: Experiment) {
  if (
    formikValues.target.pod_chaos.action === 'pod-kill' ||
    formikValues.target.pod_chaos.action === 'container-kill'
  ) {
    return true
  }

  return false
}

export function resetOtherChaos(formProps: FormikCtx, kind: string, action: string | boolean) {
  const { values, setFieldValue } = formProps

  const selectedChaosKind = kind
  const selectedChaosKey = ChaosKindKeyMap[selectedChaosKind].key

  const updatedTarget = {
    ...defaultExperimentSchema.target,
    kind: selectedChaosKind,
    [selectedChaosKey]: {
      ...values.target[selectedChaosKey],
      ...(action
        ? {
            action,
          }
        : {}),
    },
  }

  setFieldValue('target', updatedTarget)
}

function selectorsToArr(selectors: Object, separator: string) {
  return Object.entries(selectors).map(([key, val]) => `${key}${separator}${val}`)
}

export function parseLoaded(e: Experiment): Experiment {
  const result = e

  result.labels = result.labels ? selectorsToArr(result.labels, ':') : []
  result.annotations = result.annotations ? selectorsToArr(result.annotations, ':') : []
  result.scope.label_selectors = result.scope.label_selectors ? selectorsToArr(result.scope.label_selectors, ': ') : []
  result.scope.annotation_selectors = result.scope.annotation_selectors
    ? selectorsToArr(result.scope.annotation_selectors, ': ')
    : []
  result.scope.phase_selectors = result.scope.phase_selectors ? result.scope.phase_selectors : ['all']

  result.target = {
    ...defaultExperimentSchema.target,
    ...result.target,
  }

  if (result.target.kind === 'NetworkChaos' && result.target.network_chaos.target) {
    result.target.network_chaos.target.label_selectors = result.target.network_chaos.target.label_selectors
      ? selectorsToArr(result.target.network_chaos.target.label_selectors, ': ')
      : []
    result.target.network_chaos.target.annotation_selectors = result.target.network_chaos.target.annotation_selectors
      ? selectorsToArr(result.target.network_chaos.target.annotation_selectors, ': ')
      : []
  }

  return result
}

export function yamlToExperiment(yamlObj: any): Experiment {
  const { kind, metadata, spec } = snakeCaseKeys(yamlObj)

  let halfResult = {
    ...defaultExperimentSchema,
    ...metadata,
    labels: metadata.labels ? selectorsToArr(metadata.labels, ':') : [],
    annotations: metadata.annotations ? selectorsToArr(metadata.annotations, ':') : [],
    scope: {
      ...defaultExperimentSchema.scope,
      label_selectors: spec.selector?.label_selectors ? selectorsToArr(spec.selector.label_selectors, ': ') : [],
      annotation_selectors: spec.selector?.annotation_selectors
        ? selectorsToArr(spec.selector.annotation_selectors, ': ')
        : [],
      mode: spec.mode,
    },
    scheduler: {
      cron: spec.scheduler?.cron ?? '',
      duration: spec.duration ?? '',
    },
  }

  delete spec.selector
  delete spec.mode
  delete spec.scheduler
  delete spec.duration

  if (kind === 'KernelChaos' && spec.fail_kern_request) {
    spec.fail_kern_request.callchain = spec.fail_kern_request.callchain.map((frame: CallchainFrame) => {
      if (!frame.parameters) {
        frame.parameters = ''
      }

      if (!frame.predicate) {
        frame.predicate = ''
      }

      return frame
    })

    spec.fail_kern_request = {
      ...defaultExperimentSchema.target.kernel_chaos.fail_kern_request,
      ...spec.fail_kern_request,
    }
  }

  if (kind === 'StressChaos') {
    spec.stressors.cpu = {
      ...defaultExperimentSchema.target.stress_chaos.stressors.cpu,
      ...spec.stressors.cpu,
    }

    spec.stressors.memory = {
      ...defaultExperimentSchema.target.stress_chaos.stressors.memory,
      ...spec.stressors.memory,
    }
  }

  if (['IoChaos', 'KernelChaos', 'TimeChaos', 'StressChaos'].includes(kind)) {
    return {
      ...halfResult,
      target: {
        ...defaultExperimentSchema.target,
        kind,
        [ChaosKindKeyMap[kind].key]: {
          ...defaultExperimentSchema.target[ChaosKindKeyMap[kind].key],
          ...spec,
        },
      },
    }
  }

  const action = Object.keys(spec).filter((k) => k === spec.action)[0]

  if (kind === 'NetworkChaos') {
    const label_selectors = spec.target?.selector?.label_selectors
      ? selectorsToArr(spec.target.selector.label_selectors, ': ')
      : []
    const annotation_selectors = spec.target?.selector?.annotation_selectors
      ? selectorsToArr(spec.target.selector.annotation_selectors, ': ')
      : []

    spec.target?.selector && delete spec.target.selector

    return {
      ...halfResult,
      target: {
        ...defaultExperimentSchema.target,
        kind,
        network_chaos: {
          action: spec.action,
          ...(spec.action === 'partition'
            ? { direction: spec.direction }
            : {
                [action]: spec[action],
              }),
          target: spec.target
            ? {
                ...defaultExperimentSchema.scope,
                ...spec.target,
                label_selectors,
                annotation_selectors,
              }
            : undefined,
        },
      },
    }
  }

  // PodChaos
  return {
    ...halfResult,
    target: {
      ...defaultExperimentSchema.target,
      pod_chaos: {
        action: spec.action,
        [action]: spec[action],
      },
    },
  }
}
