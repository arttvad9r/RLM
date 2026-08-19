export class Yoke321Local3 {
  unit = new Map<string, string>()

  invokeAction(k: string) {
    this.unit.set(k, k)
  }
}
