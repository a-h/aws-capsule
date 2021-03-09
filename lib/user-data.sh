#!/bin/sh
# Install SSM agent to be able to log in remotely.
sudo yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_arm64/amazon-ssm-agent.rpm
restart amazon-ssm-agent

# Configure AWS Logs to push to CloudWatch.
sudo yum install -y amazon-cloudwatch-agent
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << 'EOF'
{
        "agent": {
                "metrics_collection_interval": 60,
                "run_as_user": "root"
        },
        "logs": {
                "logs_collected": {
                        "files": {
                                "collect_list": [
                                        {
                                                "file_path": "/var/log/geminid/log.txt",
                                                "log_group_name": "geminid",
                                                "log_stream_name": "{instance_id}"
                                        }
                                ]
                        }
                }
        },
        "metrics": {
                "append_dimensions": {
                        "AutoScalingGroupName": "${aws:AutoScalingGroupName}",
                        "ImageId": "${aws:ImageId}",
                        "InstanceId": "${aws:InstanceId}",
                        "InstanceType": "${aws:InstanceType}"
                },
                "metrics_collected": {
                        "cpu": {
                                "measurement": [
                                        "cpu_usage_idle",
                                        "cpu_usage_iowait",
                                        "cpu_usage_user",
                                        "cpu_usage_system"
                                ],
                                "metrics_collection_interval": 60,
                                "resources": [
                                        "*"
                                ],
                                "totalcpu": false
                        },
                        "disk": {
                                "measurement": [
                                        "used_percent",
                                        "inodes_free"
                                ],
                                "metrics_collection_interval": 60,
                                "resources": [
                                        "*"
                                ]
                        },
                        "diskio": {
                                "measurement": [
                                        "io_time"
                                ],
                                "metrics_collection_interval": 60,
                                "resources": [
                                        "*"
                                ]
                        },
                        "mem": {
                                "measurement": [
                                        "mem_used_percent"
                                ],
                                "metrics_collection_interval": 60
                        },
                        "swap": {
                                "measurement": [
                                        "swap_used_percent"
                                ],
                                "metrics_collection_interval": 60
                        }
                }
        }
}
EOF
sudo systemctl enable amazon-cloudwatch-agent.service
sudo systemctl start amazon-cloudwatch-agent.service

# Create user.
sudo useradd geminid

# Start installation.
cd ~

# Install github.com/a-h/gemini server.
wget https://github.com/a-h/gemini/releases/download/v0.0.51/gemini_0.0.51_Linux_arm64.tar.gz
tar -xf gemini_0.0.51_Linux_arm64.tar.gz
sudo mv gemini /usr/bin/

# Create a log directory.
sudo mkdir -p /var/log/geminid
sudo chown geminid:geminid /var/log/geminid

# Create a content directory.
sudo mkdir -p /srv/gemini
sudo chown geminid:geminid /srv/gemini

# Create a config directory.
sudo mkdir -p /etc/gemini
sudo chown geminid:geminid /etc/gemini

# Download the server keys.
sudo aws s3 sync s3://$BUCKET/keys /etc/gemini

# Download the initial content.
sudo aws s3 sync s3://$BUCKET/content /srv/gemini

# Create the geminid systemd service.
# Note that it redirects the log output to /var/log/geminid/log.txt
# Later versions of systemd support appending to files, but at the time of writing, Amazon Linux 2 shipped with version 219 of systemd.
sudo tee /etc/systemd/system/geminid.service > /dev/null << 'EOF'
[Unit]
Description=geminid

[Service]
User=geminid
Group=geminid
Type=simple
Restart=always
WorkingDirectory=/srv/gemini
ExecStart=/bin/sh -c '/usr/bin/gemini serve --domain=$DOMAIN --certFile=/etc/gemini/server.crt --keyFile=/etc/gemini/server.key --path=/srv/gemini >> /var/log/geminid/log.txt 2>&1'
EOF

# Start and enable geminid on startup.
sudo systemctl start geminid
sudo systemctl enable geminid

# Rotate the geminid logs.
sudo tee /etc/logrotate.d/geminid > /dev/null << 'EOF'
/var/log/geminid/*.txt {
        daily
        copytruncate
        missingok
        rotate 7
        notifempty
}
EOF
