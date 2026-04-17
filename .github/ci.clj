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

(defn release-stage [tag]
  (gh-group "🚀 Create GitHub Release")
  (let [vsix (first (filter #(.endsWith % ".vsix")
                            (map str (.listFiles (java.io.File. ".")))))]
    (when-not vsix
      (gh-error "No .vsix file found")
      (System/exit 1))
    (run-bash (str "gh release create " tag
                   " --title \"spai " tag "\""
                   " --generate-notes"
                   " " vsix)))
  (gh-endgroup))

(defn local-version []
  (-> (slurp "package.json")
      (->> (re-find #"\"version\"\s*:\s*\"([^\"]+)\""))
      second))

(defn published-versions []
  (let [result (shell/sh "bash" "-c" "npx vsce show spoqe.spai --json 2>/dev/null || echo '{}'")]
    (set (re-seq #"\d+\.\d+\.\d+" (:out result)))))

(defn publish-stage [git-ref]
  (gh-group "🚀 Publish to VS Code Marketplace")
  (let [version      (local-version)
        published    (published-versions)
        pre-release? (str/starts-with? git-ref "refs/heads/release/")
        flag         (if pre-release? " --pre-release" "")]
    (cond
      (not version)
      (do (gh-error "Could not parse version from package.json") (System/exit 1))

      (contains? published version)
      (gh-notice (str "v" version " already published — skipping (bump package.json to publish)"))

      :else
      (do
        (println (str "Publishing v" version " (" (if pre-release? "pre-release" "stable") ")..."))
        (run-bash (str "npx vsce publish --no-dependencies" flag)))))
  (gh-endgroup))

;; Main pipeline
(defn run-pipeline []
  (install-stage)
  (compile-stage)
  (package-stage))

(defn release-pipeline [tag]
  (run-pipeline)
  (release-stage tag))

;; CLI
(defn -main [& args]
  (case (first args)
    "run"     (run-pipeline)
    "install" (install-stage)
    "compile" (do (install-stage) (compile-stage))
    "package" (run-pipeline)
    "publish" (if-let [git-ref (second args)]
                (publish-stage git-ref)
                (do (gh-error "publish requires a git ref argument") (System/exit 1)))
    "release" (if-let [tag (second args)]
                (release-pipeline tag)
                (do (gh-error "release requires a tag argument") (System/exit 1)))
    (do
      (println "Usage: bb ci.clj <command>")
      (println)
      (println "Commands:")
      (println "  run              Run entire pipeline (install → compile → package)")
      (println "  install          Install dependencies only")
      (println "  compile          Install + compile TypeScript")
      (println "  package          Full pipeline including VSIX packaging")
      (println "  publish <ref>    Publish to marketplace (stable for main, pre-release for release/*)")
      (println "  release <tag>    Full pipeline + create GitHub Release"))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
