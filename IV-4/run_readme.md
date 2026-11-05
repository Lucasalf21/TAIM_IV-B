Local study app
===============

Run these commands from:

    /IV-4

Install dependencies
--------------------

    ./venv/bin/python -m pip install -r requirements.txt

Start the server
-----------------

    ./venv/bin/python app.py

Open the participant app:

    http://127.0.0.1:5000/

Open the admin dashboard:

    http://127.0.0.1:5000/admin

Reset the whole database
------------------------

Stop the server first, then run:

    rm study_results.db

The database will be recreated automatically the next time the app starts.

Delete one participant
----------------------

Replace `P123456` with the participant code to delete. Stop the server first,
then run:

    ./venv/bin/python -c "import sqlite3; c=sqlite3.connect('study_results.db'); c.execute('DELETE FROM responses WHERE participant_code = ?', ('P123456',)); c.execute('DELETE FROM participants WHERE participant_code = ?', ('P123456',)); c.commit(); c.close()"

This deletes the participant and all episode responses associated with that
participant.
