import type { CustomPin } from '../../types/listing'

export interface CustomPinsBarProps {
    customPins: CustomPin[]
    setCustomPins: React.Dispatch<React.SetStateAction<CustomPin[]>>
}
