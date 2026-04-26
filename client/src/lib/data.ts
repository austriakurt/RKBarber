export type Barber = {
  id: string;
  name: string;
  reservePrice: number;
  walkinPrice: number;
  active: boolean;
  nextAvailable: string;
  image: string;
};

export const barbers: Barber[] = [
  { id: "1", name: "Abu", reservePrice: 300, walkinPrice: 200, active: true, nextAvailable: "10:30 AM", image: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=500&h=500&fit=crop" },
  { id: "2", name: "Jaymar", reservePrice: 300, walkinPrice: 200, active: true, nextAvailable: "11:00 AM", image: "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=500&h=500&fit=crop" },
  { id: "3", name: "JP", reservePrice: 200, walkinPrice: 120, active: true, nextAvailable: "Now", image: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=500&h=500&fit=crop" },
  { id: "4", name: "Jienray", reservePrice: 200, walkinPrice: 120, active: true, nextAvailable: "1:00 PM", image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=500&h=500&fit=crop" },
  { id: "5", name: "Demar", reservePrice: 200, walkinPrice: 120, active: true, nextAvailable: "Now", image: "https://images.unsplash.com/photo-1534308143481-c55f00be8bd7?w=500&h=500&fit=crop" },
  { id: "6", name: "Jomar", reservePrice: 200, walkinPrice: 120, active: true, nextAvailable: "2:30 PM", image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500&h=500&fit=crop" },
];

export type QueueItem = {
  id: string;
  barberId: string;
  customerName: string;
  position: number;
  status: 'waiting' | 'in-progress' | 'done';
};

export const mockQueue: QueueItem[] = [
  { id: "q1", barberId: "1", customerName: "Mark", position: 1, status: 'in-progress' },
  { id: "q2", barberId: "1", customerName: "Kevin", position: 2, status: 'waiting' },
  { id: "q3", barberId: "1", customerName: "Paolo", position: 3, status: 'waiting' },
  { id: "q4", barberId: "3", customerName: "John", position: 1, status: 'waiting' },
  { id: "q5", barberId: "3", customerName: "Rico", position: 2, status: 'waiting' },
];

export const mockTimeslots = [
  "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
  "12:00 PM", "1:00 PM", "1:30 PM", "2:00 PM",
  "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM",
  "4:30 PM", "5:00 PM", "5:30 PM", "6:00 PM"
];