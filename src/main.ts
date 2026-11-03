import "./style.css";
import { App } from "./ui/app";

const app = new App();
// accès pour les tests de bout en bout
(window as unknown as { __esprit: App }).__esprit = app;
