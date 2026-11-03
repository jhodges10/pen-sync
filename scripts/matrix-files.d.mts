interface Component {
  id: string;
  file: string;
}
export function matrixFile(component: Component): string;
export function storiesFile(component: Component): string;
export function storyExport(component: Component): string;
export function storyIdSuffix(component: Component): string;
