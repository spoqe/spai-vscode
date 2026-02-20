#!/usr/bin/env bb
;; spai-vscode CI — Pure Clojure, no YAML, no interpretation

(require '[clojure.java.shell :as shell]
         '[clojure.string :as str])

;; GitHub Actions workflow command emitters
(defn gh-group [name] (println (str "::group::" name)))
(defn gh-endgroup [] (println "::endgroup::"))
(defn gh-error [msg] (println (str "::error::" msg)))
(defn gh-notice [msg] (println (str "::notice::" msg)))

(defn run-bash [cmd & [{:keys [continue-on-error] :or {continue-on-error false}}]]
  (println (str "$ " cmd))
  (let [result (shell/sh "bash" "-c" cmd)]
    (print (:out result))
    (print (:err result))
    (when-not (zero? (:exit result))
      (if continue-on-error
        (gh-notice (str "Command failed but continuing: " cmd))
        (do
          (gh-error (str "Command failed: " cmd))
          (System/exit (:exit result)))))
    result))

;; Pipeline stages
(defn install-stage []
  (gh-group "📦 Install dependencies")
  (run-bash "npm install")
  (gh-endgroup))

(defn compile-stage []
  (gh-group "🔨 Compile TypeScript")
  (run-bash "npx tsc -p ./")
  (gh-endgroup))

(defn package-stage []
  (gh-group "📦 Package VSIX")
  (run-bash "npx vsce package --no-dependencies")
  (gh-endgroup))

;; Main pipeline
(defn run-pipeline []
  (install-stage)
  (compile-stage)
  (package-stage))

;; CLI
(defn -main [& args]
  (case (first args)
    "run"     (run-pipeline)
    "install" (install-stage)
    "compile" (do (install-stage) (compile-stage))
    "package" (run-pipeline)
    (do
      (println "Usage: bb ci.clj <command>")
      (println)
      (println "Commands:")
      (println "  run       Run entire pipeline (install → compile → package)")
      (println "  install   Install dependencies only")
      (println "  compile   Install + compile TypeScript")
      (println "  package   Full pipeline including VSIX packaging"))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
