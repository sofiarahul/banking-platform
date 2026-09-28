"""Minimal H2 access layer driven through the H2 jar's command line tools.

There is no pure-Python H2 driver, and JPype/JayDeBeApi have no wheels for
Python 3.14, so every statement is handed to `org.h2.tools.RunScript`. Reads
go through H2's own CSVWRITE function, which dumps a result set to a CSV file
the script then reads back with the csv module.

The backend opens the database with AUTO_SERVER=TRUE, so this connects fine
while the Spring Boot app is running.
"""

import csv
import glob
import os
import subprocess
import tempfile

DEFAULT_M2_GLOB = os.path.expanduser(
    "~/.m2/repository/com/h2database/h2/*/h2-*.jar")


def find_h2_jar():
    """Locates the H2 jar: $H2_JAR if set, else the newest one in the Maven cache."""
    from_env = os.environ.get("H2_JAR")
    if from_env:
        if not os.path.isfile(from_env):
            raise FileNotFoundError("H2_JAR is set but does not exist: %s" % from_env)
        return from_env

    jars = sorted(glob.glob(DEFAULT_M2_GLOB))
    if not jars:
        raise FileNotFoundError(
            "No H2 jar found in the Maven cache (%s). Build the backend once "
            "with `mvn dependency:resolve`, or set H2_JAR to the jar path."
            % DEFAULT_M2_GLOB)
    return jars[-1]


def default_db_url():
    """Builds the JDBC URL for the repo's H2 file database.

    Mirrors backend/src/main/resources/application.properties, which uses the
    relative path ./data/digitalbankdb from the backend/ working directory.
    """
    from_env = os.environ.get("DB_URL")
    if from_env:
        return from_env

    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    db_path = os.path.join(repo_root, "backend", "data", "digitalbankdb")
    return "jdbc:h2:file:%s;AUTO_SERVER=TRUE" % db_path.replace("\\", "/")


class H2Database:
    def __init__(self, url=None, user="sa", password="", jar=None):
        self.url = url or default_db_url()
        self.user = user
        self.password = password
        self.jar = jar or find_h2_jar()

    def execute(self, sql):
        """Runs one or more statements. Raises RuntimeError on a SQL error."""
        script = tempfile.NamedTemporaryFile(
            mode="w", suffix=".sql", delete=False, encoding="utf-8")
        try:
            script.write(sql)
            script.close()
            self._run_script(script.name)
        finally:
            os.unlink(script.name)

    def query(self, sql):
        """Runs a SELECT and returns a list of dicts (all values as strings)."""
        out = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
        out.close()
        try:
            csv_path = out.name.replace("\\", "/")
            self.execute("CALL CSVWRITE('%s', '%s');" % (csv_path, escape(sql)))
            with open(out.name, newline="", encoding="utf-8") as handle:
                return list(csv.DictReader(handle))
        finally:
            os.unlink(out.name)

    def scalar(self, sql):
        """Runs a SELECT expected to return one row of one column."""
        rows = self.query(sql)
        if not rows:
            return None
        return list(rows[0].values())[0]

    def _run_script(self, script_path):
        result = subprocess.run(
            ["java", "-cp", self.jar, "org.h2.tools.RunScript",
             "-url", self.url, "-user", self.user, "-password", self.password,
             "-script", script_path],
            capture_output=True, text=True)

        # RunScript reports SQL problems on stderr; a clean run prints nothing.
        if result.returncode != 0 or result.stderr.strip():
            raise RuntimeError(
                "H2 statement failed (exit %d):\n%s%s"
                % (result.returncode, result.stdout, result.stderr))


def escape(value):
    """Escapes a Python string for use inside a single-quoted SQL literal."""
    return str(value).replace("'", "''")
