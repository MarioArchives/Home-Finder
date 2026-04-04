export interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    name: string
    value: number
    color?: string
    fill?: string
  }>
  label?: string
  formatter?: (value: number) => string
}
